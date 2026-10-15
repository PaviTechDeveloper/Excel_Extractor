import 'dotenv/config';
import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import ExcelJS from 'exceljs';
import { Readable } from 'node:stream';
import { body, validationResult } from 'express-validator';
import { z } from 'zod';
import { all, asDate, get, run } from './database.js';
import { auditLogs, candidates, importHistory, recruiters, requirements, settings } from './models.js';
import { ageDays, duplicateKey, normalize } from './domain.js';

const app = express();
const port = Number(process.env.PORT || 4000);
const maxUpload = Number(process.env.MAX_UPLOAD_MB || 15) * 1024 * 1024;
app.use(helmet()); app.use(cors({ origin: process.env.FRONTEND_ORIGIN || 'http://localhost:5173' }));
app.use(express.json({ limit: '1mb' })); app.use(rateLimit({ windowMs: 60_000, limit: 180 }));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxUpload, files: 1 }, fileFilter: (_req, file, cb) => /\.(xlsx|xls)$/i.test(file.originalname) ? cb(null, true) : cb(new Error('Only .xlsx and .xls files are supported.')) });
const asyncRoute = (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown> | unknown) => (req: Request, res: Response, next: NextFunction) => Promise.resolve(fn(req, res, next)).catch(next);
const valid = (req: Request, res: Response, next: NextFunction) => { const errors = validationResult(req); if (!errors.isEmpty()) return res.status(400).json({ message: 'Invalid request', errors: errors.array() }); next(); };
const allowedFields = ['accountName','soNumber','requirementDetails','jobRole','candidateName','candidateId','candidateEmail','candidatePhone','recruiterName','dateRequirementOpened','dateCandidateReceived','dateCandidatePresented','numberCandidatesPresented','applicationStatus','candidateStatus','currentStatus','clientFeedback','interviewDate','joiningDate','remarks','lastUpdatedDate','totalExperience','ageingDays','ageingCategory'] as const;
const aliases: Record<string,string> = { accountname:'accountName',account:'accountName',client:'accountName',sonumber:'soNumber',rrnumber:'soNumber',rrno:'soNumber',rr:'soNumber',rrinhiring:'soNumber',requisitionnumber:'soNumber',servicenumber:'soNumber',serviceordernumber:'soNumber',requirementid:'soNumber',requirementdetails:'requirementDetails',jobrole:'jobRole',role:'jobRole',designation:'jobRole',mandatoryskill:'jobRole',candidateid:'candidateId',candidatename:'candidateName',name:'candidateName',candidateemail:'candidateEmail',emailid:'candidateEmail',email:'candidateEmail',candidatephone:'candidatePhone',contactnumber:'candidatePhone',phone:'candidatePhone',recruitername:'recruiterName',recruiter:'recruiterName',profilesubmissiondate:'dateCandidateReceived',daterequirementopened:'dateRequirementOpened',requirementopeneddate:'dateRequirementOpened',datecandidatereceived:'dateCandidateReceived',receiveddate:'dateCandidateReceived',datecandidatepresented:'dateCandidatePresented',presenteddate:'dateCandidatePresented',numberofcandidatespresented:'numberCandidatesPresented',applicationstatus:'applicationStatus',candidatestatus:'candidateStatus',currentstatus:'currentStatus',rrstatus:'currentStatus',clientfeedback:'clientFeedback',interviewdate:'interviewDate',joiningdate:'joiningDate',remarks:'remarks',lastupdateddate:'lastUpdatedDate',totalitexp:'totalExperience',totalexperience:'totalExperience',actualageing:'ageingDays',actualageingcategory:'ageingCategory' };
const parseDate = (v: unknown) => { if (!v) return undefined; const d = v instanceof Date ? v : new Date(String(v)); return Number.isNaN(d.getTime()) ? undefined : d; };
const clean = (v: unknown) => typeof v === 'string' ? v.trim() : v;
const rowMap = (headers: unknown[], row: unknown[]) => { const out: Record<string, any> = {}, customFields: Record<string,any> = {}; headers.forEach((h,i) => { const rawHeader = String(h ?? ''); const normalizedHeader = normalize(rawHeader); const key = aliases[normalizedHeader]; const val = clean(row[i]); if (val === null || val === undefined || val === '') return; if (key && out[key] === undefined) out[key] = val; else if (!key && h) customFields[rawHeader] = val; }); out.customFields = customFields; for (const d of ['dateRequirementOpened','dateCandidateReceived','dateCandidatePresented','interviewDate','joiningDate','lastUpdatedDate']) if (out[d]) out[d] = parseDate(out[d]); if (out.totalExperience !== undefined) out.totalExperience = String(out.totalExperience); if (out.ageingDays !== undefined) { const age = Number(String(out.ageingDays).replace(/[^0-9.-]/g,'')); out.ageingDays = Number.isFinite(age) ? age : undefined; } return out; };
const queryFilters = (query: any, fields: string[]) => Object.fromEntries(fields.filter(k => query[k]).map(k => [k, String(query[k])]));
const pending = new Map<string,{fileName:string,rows:any[]}>();
const detectHeaderRow = (sheet: ExcelJS.Worksheet) => {
  let best = { row: 1, score: -1, headers: [] as unknown[] };
  for (let rowNumber=1;rowNumber<=Math.min(sheet.rowCount,20);rowNumber++) {
    const headers: unknown[]=[];
    sheet.getRow(rowNumber).eachCell({includeEmpty:true},(cell,index)=>headers[index-1]=cell.value);
    const recognized=headers.filter(value=>aliases[normalize(String(value??''))]).length;
    const nonEmpty=headers.filter(Boolean).length;
    const score=recognized*10+Math.min(nonEmpty,20);
    if(score>best.score)best={row:rowNumber,score,headers};
  }
  return best;
};
const googleSheetsCsvUrl = (input: string) => {
  let url: URL;
  try { url=new URL(input); } catch { throw new Error('Enter a valid Google Sheets URL.'); }
  if(url.hostname!=='docs.google.com'||!url.pathname.includes('/spreadsheets/d/')) throw new Error('Only Google Sheets links are supported.');
  const id=url.pathname.split('/')[3];
  if(!id) throw new Error('The Google Sheets URL does not contain a spreadsheet ID.');
  return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${encodeURIComponent(url.searchParams.get('gid')||'0')}`;
};

app.get('/api/health', (_req,res) => res.json({ ok: true, database: true }));
app.get('/api/dashboard/summary', asyncRoute((req,res) => {
  const filter = queryFilters(req.query,['accountName','soNumber','jobRole','recruiterName','currentStatus']);
  const requirementFilter = Object.fromEntries(Object.entries(filter).filter(([key]) => ['accountName','soNumber','jobRole','recruiterName'].includes(key)));
  const totalApplications = candidates.count(filter), totalRequirements = requirements.count(requirementFilter);
  const statuses = candidates.statusCounts(filter);
  const statusMap = Object.fromEntries(statuses.map((s:any)=>[s._id,s.count]));
  const candidatesPresented = candidates.presentedCount(filter);
  const activeRequirements = requirements.requirementsByAge('dateOpened','>=',new Date(Date.now()-30*864e5).toISOString(),requirementFilter);
  const overdueRequirements = requirements.requirementsByAge('dateOpened','<',new Date(Date.now()-14*864e5).toISOString(),requirementFilter);
  res.json({ totalRequirements, activeRequirements, totalApplications, candidatesPresented, inProgress: statusMap['In Progress'] || 0, selected: statusMap.Selected || 0, rejected: statusMap.Rejected || 0, onHold: statusMap['On Hold'] || 0, overdueRequirements });
}));
app.get('/api/dashboard/charts', asyncRoute((req,res) => {
  const filter = queryFilters(req.query,['accountName','soNumber','jobRole','recruiterName','currentStatus']);
  const group = (field:string) => candidates.grouped(field,filter);
  const roles = group('jobRole'), accounts = group('accountName'), statuses = group('currentStatus'), recruiterRows = group('recruiterName');
  const requirementRows = candidates.requirementGroups(filter);
  const monthly = candidates.monthly(filter);
  res.json({ roles,accounts,statuses,recruiters:recruiterRows,requirements:requirementRows,monthly });
}));
app.post('/api/import/preview', upload.single('file'), asyncRoute(async (req,res) => {
  if (!req.file && !req.body?.sourceUrl) return res.status(400).json({ message:'Choose an Excel file or enter a Google Sheets link.' });
  try { const wb = new ExcelJS.Workbook(); let fileName=req.file?.originalname||'google-sheet.csv';
    if(req.file) await wb.xlsx.load(req.file.buffer as any);
    else { const csvUrl=googleSheetsCsvUrl(String(req.body.sourceUrl)); const response=await fetch(csvUrl,{signal:AbortSignal.timeout(15000)}); if(!response.ok)throw new Error(`Google Sheets export failed (${response.status}). Make sure the sheet is shared as viewer or published.`); const csv=await response.text(); if(Buffer.byteLength(csv)>maxUpload)throw new Error(`The Google Sheet export exceeds ${process.env.MAX_UPLOAD_MB||15} MB.`); const sheetName=new URL(String(req.body.sourceUrl)).searchParams.get('gid')||'Sheet1'; await wb.csv.read(Readable.from([csv]),{sheetName}); fileName=`Google Sheet ${new URL(String(req.body.sourceUrl)).pathname.split('/')[3]}.csv`; }
    const sheets=wb.worksheets.map(s=>s.name); const sheet=wb.getWorksheet(String(req.body.sheet || sheets[0])); if(!sheet) return res.status(400).json({message:'Select a valid worksheet.'});
    const detected=detectHeaderRow(sheet); const headers=detected.headers; const rows:any[]=[]; const duplicates= new Set<string>(); let duplicateRows=0,invalidRows=0;
    for(let i=detected.row+1;i<=sheet.rowCount;i++){ const values=sheet.getRow(i).values as any[]; const raw=values.slice(1); if(raw.every(v=>v==null||v==='')) continue; const data=rowMap(headers,raw); const reasons:string[]=[]; for(const f of ['accountName','soNumber','jobRole','candidateName']) if(!data[f]) reasons.push(`Missing ${f}`); const key=duplicateKey(data); const duplicate=duplicates.has(key); duplicates.add(key); if(duplicate)duplicateRows++; if(reasons.length)invalidRows++; rows.push({rowNumber:i,data,duplicate,valid:reasons.length===0,reasons}); }
    const token=`${Date.now()}-${Math.random().toString(36).slice(2)}`; pending.set(token,{ fileName,rows }); setTimeout(()=>pending.delete(token),20*60_000);
    res.json({token,fileName,sheets,selectedSheet:sheet.name,headerRow:detected.row,headers,fields:allowedFields,rowCount:Math.max(0,sheet.rowCount-detected.row),columnCount:headers.length,rows:rows.slice(0,20),totalRows:rows.length,validRows:rows.filter(x=>x.valid&&!x.duplicate).length,duplicateRows,invalidRows,missingRequired:['accountName','soNumber','jobRole','candidateName'].filter(f=>!headers.some(h=>aliases[normalize(String(h))]===f))});
  } catch { res.status(400).json({message:'The workbook could not be read. Check that it is a valid Excel file.'}); }
}));
app.post('/api/import/confirm', asyncRoute(async (req,res) => {
  const schema=z.object({token:z.string(),mode:z.enum(['insert','update'])}); const parsed=schema.safeParse(req.body); if(!parsed.success)return res.status(400).json({message:'Invalid import confirmation.'});
  const staged=pending.get(parsed.data.token); if(!staged)return res.status(410).json({message:'Preview expired. Upload the workbook again.'}); pending.delete(parsed.data.token);
  let importedRows=0,updatedRows=0,duplicateRows=0,rejectedRows=0; const errors:any[]=[];
  for(const item of staged.rows){ const d=item.data; if(!item.valid){rejectedRows++;errors.push({row:item.rowNumber,reasons:item.reasons});continue;} const key=duplicateKey(d); try{
    const reqDoc=requirements.upsert({soNumber:d.soNumber,jobRole:d.jobRole,accountName:d.accountName,requirementDetails:d.requirementDetails,recruiterName:d.recruiterName,dateOpened:d.dateRequirementOpened});
    const existing=candidates.byApplicationId(key);
    if(existing){ if(parsed.data.mode==='update'){ candidates.update(existing._id,{...d,requirement:reqDoc?._id,lastUpdatedDate:new Date()});updatedRows++;}else duplicateRows++; }
    else { candidates.create({...d,requirement:reqDoc?._id,applicationId:key});importedRows++; }
    if(d.recruiterName) recruiters.upsert(d.recruiterName);
  }catch(e:any){rejectedRows++;errors.push({row:item.rowNumber,reasons:[e.message]});} }
  const history=importHistory.create({fileName:staged.fileName,totalRows:staged.rows.length,importedRows,updatedRows,duplicateRows,rejectedRows,status:rejectedRows?'completed_with_errors':'completed',mode:parsed.data.mode,errors});
  res.json({importId:history?._id,totalRows:staged.rows.length,importedRows,updatedRows,duplicateRows,rejectedRows,status:history?.status,errors});
}));
app.get('/api/import/history',asyncRoute((_req,res)=>res.json(importHistory.list())));
app.get('/api/import/:id/errors',asyncRoute(async(req,res)=>{const h=importHistory.get(String(req.params.id));if(!h)return res.status(404).json({message:'Import not found.'});const wb=new ExcelJS.Workbook(),s=wb.addWorksheet('Rejected rows');s.columns=[{header:'Row',key:'row',width:12},{header:'Errors',key:'errors',width:70}];s.addRows((h.errors as any[]).map(e=>({row:e.row,errors:(e.reasons||[]).join('; ')})));res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');res.setHeader('Content-Disposition','attachment; filename="import-errors.xlsx"');await wb.xlsx.write(res);res.end();}));
app.get('/api/requirements',asyncRoute(async(req,res)=>{const page=Math.max(1,Number(req.query.page)||1),limit=Math.min(100,Math.max(1,Number(req.query.limit)||20));const filter=queryFilters(req.query,['accountName','soNumber','jobRole','recruiterName']);if(req.query.search)filter.$search=String(req.query.search);const items=requirements.list(filter,(page-1)*limit,limit);const total=requirements.count(filter);res.json({items:items.map((x:any)=>{const metrics=get('SELECT COUNT(*) AS count, SUM(CASE WHEN dateCandidatePresented IS NOT NULL THEN 1 ELSE 0 END) AS presented FROM candidates WHERE requirement = ?',[x._id]) as any;return {...x,metrics:{count:metrics.count||0,presented:metrics.presented||0},ageing:ageDays(x.dateOpened?new Date(x.dateOpened):null)};}),total,page,limit});}));
app.get('/api/requirements/:id',asyncRoute(async(req,res)=>{const item=requirements.get(String(req.params.id));if(!item)return res.status(404).json({message:'Requirement not found.'});const rows=candidates.byRequirement(item._id);res.json({requirement:item,candidates:rows.map((c:any)=>({...c,ageing:ageDays(c.dateCandidateReceived?new Date(c.dateCandidateReceived):null),pendingPresentationAgeing:!c.dateCandidatePresented?ageDays(c.dateCandidateReceived?new Date(c.dateCandidateReceived):null):null,feedbackAgeing:c.dateCandidatePresented&&!c.clientFeedback?ageDays(new Date(c.dateCandidatePresented)):null}))});}));
const candidateFilter=(q:any)=>{const filter=queryFilters(q,['accountName','soNumber','jobRole','recruiterName','applicationStatus','candidateStatus','currentStatus']);if(q.search)filter.$search=String(q.search);return filter;};
app.get('/api/candidates',asyncRoute(async(req,res)=>{const page=Math.max(1,Number(req.query.page)||1),limit=Math.min(100,Math.max(1,Number(req.query.limit)||25));const allowedSort=['candidateName','accountName','soNumber','jobRole','recruiterName','createdAt','applicationStatus','candidateStatus','currentStatus','dateCandidatePresented'];const sort=allowedSort.includes(String(req.query.sort))?String(req.query.sort):'createdAt';const order=req.query.order==='asc'?'ASC':'DESC';const filter=candidateFilter(req.query);const items=candidates.list(filter,sort,order,(page-1)*limit,limit);const total=candidates.count(filter);res.json({items:items.map((c:any)=>({...c,ageing:ageDays(c.dateCandidateReceived?new Date(c.dateCandidateReceived):null)})),total,page,limit,pages:Math.ceil(total/limit)});}));
app.get('/api/candidates/:id',asyncRoute(async(req,res)=>{const c=candidates.get(String(req.params.id));if(!c)return res.status(404).json({message:'Candidate not found.'});res.json({...c,ageing:ageDays(c.dateCandidateReceived?new Date(c.dateCandidateReceived):null)});}));
app.post('/api/candidates',body('accountName').isString().trim().notEmpty(),body('candidateName').isString().trim().notEmpty(),body('soNumber').isString().trim().notEmpty(),body('jobRole').isString().trim().notEmpty(),valid,asyncRoute(async(req,res)=>{const d=req.body;const reqDoc=requirements.upsert({soNumber:d.soNumber,jobRole:d.jobRole,accountName:d.accountName,recruiterName:d.recruiterName,requirementDetails:d.requirementDetails});const c=candidates.create({...d,requirement:reqDoc?._id,applicationId:duplicateKey(d)});res.status(201).json(c);}));
app.put('/api/candidates/:id',asyncRoute(async(req,res)=>{const id=String(req.params.id);const before=candidates.get(id);if(!before)return res.status(404).json({message:'Candidate not found.'});const next={...req.body};delete next._id;delete next.applicationId;delete next.requirement;next.lastUpdatedDate=new Date();const updated=candidates.update(id,next);auditLogs.create({applicationId:before.applicationId,action:'candidate_updated',changedBy:'local_user',changes:next});res.json(updated);}));
app.patch('/api/candidates/:id/status',body('currentStatus').optional().isString(),body('applicationStatus').optional().isString(),body('candidateStatus').optional().isString(),valid,asyncRoute(async(req,res)=>{const changes:any={};for(const k of ['currentStatus','applicationStatus','candidateStatus'])if(req.body[k]!==undefined)changes[k]=req.body[k];if(!Object.keys(changes).length)return res.status(400).json({message:'Provide a status field.'});changes.lastUpdatedDate=new Date();const c=candidates.update(String(req.params.id),changes);if(!c)return res.status(404).json({message:'Candidate not found.'});auditLogs.create({applicationId:c.applicationId,action:'status_changed',changedBy:'local_user',changes});res.json(c);}));
app.get('/api/recruiters/performance',asyncRoute((_req,res)=>{
  const records=all(`SELECT id AS _id,accountName,soNumber,jobRole,recruiterName,candidateName,candidateId,candidateEmail,candidatePhone,candidateStatus,currentStatus,applicationStatus,dateCandidateReceived,dateCandidatePresented,totalExperience,ageingDays,ageingCategory,customFields,createdAt FROM candidates ORDER BY accountName,soNumber,recruiterName,candidateName`);
  const accounts=new Map<string,any>();
  for(const raw of records as any[]){
    const accountName=raw.accountName||'Unspecified account',rrNumber=raw.soNumber||'Unspecified RR',recruiterName=raw.recruiterName||'Unassigned';
    if(!accounts.has(accountName))accounts.set(accountName,{accountName,totalCandidates:0,presented:0,rrNumbers:[]});
    const account=accounts.get(accountName);
    let rr=account.rrNumbers.find((item:any)=>item.rrNumber===rrNumber);
    if(!rr){rr={rrNumber,jobRole:raw.jobRole,totalCandidates:0,presented:0,recruiters:[]};account.rrNumbers.push(rr);}
    let recruiter=rr.recruiters.find((item:any)=>item.name===recruiterName);
    if(!recruiter){recruiter={name:recruiterName,totalCandidates:0,presented:0,candidates:[]};rr.recruiters.push(recruiter);}
    const isPresented=Boolean(raw.dateCandidatePresented),age=raw.ageingDays===null?null:Number(raw.ageingDays);
    const candidate={...raw,accountName,ageing:age===null?ageDays(raw.dateCandidateReceived?new Date(raw.dateCandidateReceived):null):age};
    recruiter.totalCandidates++;rr.totalCandidates++;account.totalCandidates++;
    if(isPresented){recruiter.presented++;rr.presented++;account.presented++;}
    recruiter.candidates.push(candidate);
  }
  const accountRows=[...accounts.values()];
  const recruiterCount=accountRows.reduce((sum,a)=>sum+a.rrNumbers.reduce((rrSum:number,rr:any)=>rrSum+rr.recruiters.length,0),0);
  res.json({accounts:accountRows,totalCandidates:accountRows.reduce((sum,a)=>sum+a.totalCandidates,0),presented:accountRows.reduce((sum,a)=>sum+a.presented,0),recruiterCount});
}));
const safeCell=(v:any)=>typeof v==='string'&&/^[=+\-@\t\r]/.test(v)?`'${v}`:v;
app.get('/api/export/candidates',asyncRoute(async(req,res)=>{const rows=candidates.all(candidateFilter(req.query));const wb=new ExcelJS.Workbook(),s=wb.addWorksheet('Candidates');s.columns=[{header:'Candidate Name',key:'candidateName',width:26},{header:'Account Name',key:'accountName',width:22},{header:'RR Number',key:'soNumber',width:18},{header:'Job Role',key:'jobRole',width:26},{header:'Recruiter Name',key:'recruiterName',width:20},{header:'Presented Date',key:'dateCandidatePresented',width:18},{header:'Ageing (days)',key:'ageing',width:16},{header:'Application Status',key:'applicationStatus',width:20},{header:'Candidate Status',key:'candidateStatus',width:20},{header:'Current Status',key:'currentStatus',width:20},{header:'Last Updated',key:'lastUpdatedDate',width:18},{header:'Email',key:'candidateEmail',width:30},{header:'Phone',key:'candidatePhone',width:18},{header:'Remarks',key:'remarks',width:35}];s.addRows(rows.map((r:any)=>({ ...r,ageing:ageDays(r.dateCandidateReceived?new Date(r.dateCandidateReceived):null), ...Object.fromEntries(Object.entries(r).map(([k,v])=>[k,safeCell(v)])) })));s.views=[{state:'frozen',ySplit:1}];s.autoFilter='A1:N1';s.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};s.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF27358B'}};res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');res.setHeader('Content-Disposition','attachment; filename="candidates.xlsx"');await wb.xlsx.write(res);res.end();}));
app.get('/api/settings',asyncRoute((_req,res)=>{const saved=Object.fromEntries(settings.list().map((d:any)=>[d.key,d.value]));res.json({timezone:process.env.BUSINESS_TIMEZONE||'Asia/Kolkata',ageingThresholds:saved.ageingThresholds||[7,14],statuses:saved.statuses||{application:['New','Screening','Submitted','Interview','Offer','Closed'],candidate:['Available','Not Interested','Not Reachable','Notice Period','Joined','Rejected'],current:['In Progress','Pending Feedback','On Hold','Selected','Rejected','Withdrawn','Completed']}});}));
app.put('/api/settings',asyncRoute(async(req,res)=>{const schema=z.object({key:z.enum(['statuses','ageingThresholds']),value:z.any()});const parsed=schema.safeParse(req.body);if(!parsed.success)return res.status(400).json({message:'Invalid settings payload.'});res.json(settings.upsert(parsed.data.key,parsed.data.value));}));
app.use((err:any,_req:Request,res:Response,_next:NextFunction)=>{console.error('API error:',err.message);const status=err instanceof multer.MulterError?413:err.code==='SQLITE_CONSTRAINT_UNIQUE'?409:500;res.status(status).json({message:status===500?'Something went wrong. Check the API logs for details.':err.message});});
app.listen(port,()=>console.log(`Recruitment Tracker API listening on http://localhost:${port}`));