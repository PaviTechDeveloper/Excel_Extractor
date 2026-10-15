# Hireflow Recruitment Tracker

A responsive recruitment operations dashboard for importing real Excel candidate data, grouping it by service order and role, and tracking requirements, candidate stages, recruiter activity, and ageing. The frontend is React + TypeScript + Vite; the API is Express + TypeScript + MongoDB/Mongoose.

## Current capabilities

- Excel `.xlsx` / `.xls` upload with server-side file-size/type checks, worksheet selection, row preview, required-field validation, duplicate reporting, confirmation, and an error report.
- Automatic header detection for common recruitment terms. The core required import columns are **SO Number**, **Job Role**, and **Candidate Name**. Unmapped columns are preserved on candidate records under `customFields`.
- Requirements grouped by the compound key **SO Number + Job Role**. Candidate applications are separate documents, so a requirement can have multiple candidates.
- Idempotency key: normalized SO Number + role + candidate email when present; otherwise normalized SO Number + role + candidate name + phone. Re-imports in insert mode skip matching keys; update mode updates the matching candidate fields. Requirement account/recruiter/details are refreshed on import.
- MongoDB-backed dashboard summary/charts, requirements, searchable and paginated candidates, recruiter metrics, candidate edits and bulk status changes, settings, import history, and Excel exports.
- Separate configurable Application, Candidate, and Current status lists; ageing values use the server clock, with timezone-aware chart month grouping defaulting to Asia/Kolkata.

## Requirements

- Node.js 20 or later and npm.
- MongoDB Community Server running locally, or a reachable MongoDB deployment.

## Run on Windows PowerShell

From this project directory:

```powershell
Copy-Item .env.example .env
```

Edit `.env` and set `MONGODB_URI` to your database connection. The example uses `mongodb://127.0.0.1:27017/recruitment_tracker`; no database credentials are stored in the source code. Then install and start:

```powershell
npm.cmd install
npm.cmd run dev
```

Open <http://localhost:5173>. The API listens on <http://localhost:4000>. MongoDB must be available before the API starts. You can check the API/database status at <http://localhost:4000/api/health>.

Build both packages:

```powershell
npm.cmd run build
```

Run the backend unit tests:

```powershell
npm.cmd test
```

Run only one service:

```powershell
npm.cmd run dev -w backend
npm.cmd run dev -w frontend
```

For a compiled API deployment, first run `npm.cmd run build`, then `npm.cmd start -w backend`. Serve the frontend build in `frontend/dist` with a static web server that proxies `/api` to the API. Set `FRONTEND_ORIGIN` to the deployed frontend origin and set a production MongoDB URI in the environment.

## Import workflow

1. Open **Import history** in the sidebar, then choose **New import** (or select **Import spreadsheet** from Overview).
2. Select or drop an `.xlsx` / `.xls` workbook. The first sheet is used by default; choose another worksheet when needed.
3. Preview and check the row summary and validation results. The first 20 data rows are shown. Required fields are SO Number, Job Role, and Candidate Name.
4. Choose **Insert new** to skip duplicates or **Update existing** to update matching candidate applications and insert new ones. Confirm to write the data.
5. Download an error report from the completion summary or Import history for rejected rows.

The uploader accepts files up to `MAX_UPLOAD_MB` (15 MB by default). Application, candidate, and requirement ageing is measured in calendar days; absent dates are returned as `N/A` in the UI. Thresholds currently use 0–7 normal, 8–14 attention, and more than 14 overdue.

## Configuration

| Variable | Purpose | Default |
| --- | --- | --- |
| `PORT` | API port | `4000` |
| `MONGODB_URI` | MongoDB connection string | `mongodb://127.0.0.1:27017/recruitment_tracker` |
| `FRONTEND_ORIGIN` | Allowed browser origin for CORS | `http://localhost:5173` |
| `MAX_UPLOAD_MB` | Maximum workbook upload size | `15` |
| `BUSINESS_TIMEZONE` | IANA timezone used for trend buckets | `Asia/Kolkata` |

## API outline

- `GET /api/dashboard/summary`, `GET /api/dashboard/charts`
- `POST /api/import/preview`, `POST /api/import/confirm`, `GET /api/import/history`, `GET /api/import/:id/errors`
- `GET /api/requirements`, `GET /api/requirements/:id`
- `GET /api/candidates`, `GET /api/candidates/:id`, `POST /api/candidates`, `PUT /api/candidates/:id`, `PATCH /api/candidates/:id/status`
- `GET /api/recruiters/performance`, `GET /api/export/candidates`
- `GET /api/settings`, `PUT /api/settings`

List endpoints support server-side pagination and relevant search/filter parameters. Candidate export applies the current search/status filters and escapes spreadsheet formula-leading values.

## Security and production readiness

This implementation is a **local, single-user development application and is not production-secure**. There is no authentication or role-based access control yet; the frontend profile is illustrative only. Do not expose the API to the public internet or import real sensitive candidate data until authentication, Admin/HR Manager/Recruiter authorization and recruiter assignment scoping are implemented and tested. HTTPS, deployment-specific secret management, retention enforcement and security testing are also required before production use. Helmet, CORS origin restriction, request rate limiting, upload limits, schema validation, and server-side workbook validation provide baseline protections; they do not replace authentication/authorization.

Import preview staging is in process memory and expires after 20 minutes. A multi-instance deployment needs durable, access-controlled staging storage and cleanup. Audit entries record candidate edits/status changes but do not yet include an authenticated actor identity. The import operation currently reports duplicate/update outcomes per row; large workbook imports are processed sequentially.

## Not implemented yet

- Authentication, role-based access, user management, and authorization tests.
- Editable column-to-field mapping UI (common mappings are automatic; unmatched columns go to `customFields`).
- All-candidate date/ageing dashboard filters and every chart-category drilldown.
- Recruiter performance, requirement summary, and single-requirement export formats beyond candidate export.
- Retention policy enforcement and API/unit test suites.

No sample candidate records are seeded by default: empty dashboards show zero values until a real workbook is imported.
