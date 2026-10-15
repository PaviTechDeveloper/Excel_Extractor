export const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');

export const duplicateKey = (data: { soNumber?: string; jobRole?: string; candidateEmail?: string; candidateName?: string; candidatePhone?: string }) =>
  data.candidateEmail
    ? `${data.soNumber || ''}|${data.jobRole || ''}|${String(data.candidateEmail).trim().toLowerCase()}`
    : `${data.soNumber || ''}|${data.jobRole || ''}|${normalize(data.candidateName || '')}|${normalize(data.candidatePhone || '')}`;

export const ageDays = (date?: Date | null, now = new Date()) =>
  date ? Math.max(0, Math.floor((now.getTime() - date.getTime()) / 86_400_000)) : null;
