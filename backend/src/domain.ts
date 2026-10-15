export const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');

export const duplicateKey = (data: { accountName?: string; soNumber?: string; jobRole?: string; candidateEmail?: string; candidateName?: string; candidatePhone?: string }) =>
  `${normalize(data.accountName || '')}|${data.soNumber || ''}|${data.jobRole || ''}|` +
  (data.candidateEmail
    ? String(data.candidateEmail).trim().toLowerCase()
    : `${normalize(data.candidateName || '')}|${normalize(data.candidatePhone || '')}`);

export const ageDays = (date?: Date | null, now = new Date()) =>
  date ? Math.max(0, Math.floor((now.getTime() - date.getTime()) / 86_400_000)) : null;
