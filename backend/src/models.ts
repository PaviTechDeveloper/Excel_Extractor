import mongoose, { Schema } from 'mongoose';

const requirementSchema = new Schema({
  accountName: { type: String, index: true }, soNumber: { type: String, required: true, index: true },
  requirementDetails: String, jobRole: { type: String, required: true, index: true }, recruiterName: { type: String, index: true },
  dateOpened: Date, customFields: { type: Schema.Types.Mixed, default: {} },
}, { timestamps: true });
requirementSchema.index({ soNumber: 1, jobRole: 1 }, { unique: true });

const candidateSchema = new Schema({
  applicationId: { type: String, required: true, unique: true, index: true }, requirement: { type: Schema.Types.ObjectId, ref: 'Requirement', required: true, index: true },
  accountName: { type: String, index: true }, soNumber: { type: String, index: true }, requirementDetails: String, jobRole: { type: String, index: true },
  candidateName: { type: String, required: true }, candidateEmail: { type: String, lowercase: true, index: true }, candidatePhone: String,
  recruiterName: { type: String, index: true }, dateRequirementOpened: Date, dateCandidateReceived: Date, dateCandidatePresented: Date,
  numberCandidatesPresented: Number, applicationStatus: { type: String, index: true }, candidateStatus: { type: String, index: true },
  currentStatus: { type: String, index: true }, clientFeedback: String, interviewDate: Date, joiningDate: Date, remarks: String, lastUpdatedDate: Date,
  customFields: { type: Schema.Types.Mixed, default: {} },
}, { timestamps: true });
candidateSchema.index({ soNumber: 1, jobRole: 1, candidateEmail: 1 }, { sparse: true });
candidateSchema.index({ soNumber: 1, jobRole: 1, candidateName: 1, candidatePhone: 1 });

const importSchema = new Schema({ fileName: String, importedAt: { type: Date, default: Date.now }, totalRows: Number, importedRows: Number, updatedRows: Number, duplicateRows: Number, rejectedRows: Number, status: String, mode: String, errors: [Schema.Types.Mixed] });
const auditSchema = new Schema({ applicationId: String, action: String, changedBy: String, changes: Schema.Types.Mixed, createdAt: { type: Date, default: Date.now } });
const settingsSchema = new Schema({ key: { type: String, unique: true }, value: Schema.Types.Mixed });
const recruiterSchema = new Schema({ name: { type: String, unique: true }, email: String, active: { type: Boolean, default: true } });

export const Requirement = mongoose.model('Requirement', requirementSchema);
export const Candidate = mongoose.model('Candidate', candidateSchema);
export const ImportHistory = mongoose.model('ImportHistory', importSchema);
export const AuditLog = mongoose.model('AuditLog', auditSchema);
export const AppSetting = mongoose.model('AppSetting', settingsSchema);
export const Recruiter = mongoose.model('Recruiter', recruiterSchema);
