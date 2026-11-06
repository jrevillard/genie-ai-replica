// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// saveBlob — hand a downloaded Blob to the browser's download machinery.
//
// WHY THIS EXISTS: a protected file cannot be fetched with a plain
// `<a href>` navigation — the browser sends no Authorization header, so the
// route answers 401. The content therefore has to come through the
// authenticated client (documentFileService.downloadFile), and this helper
// turns the resulting Blob into a file on the user's disk.
//
// The revoke-on-the-next-task rule is the house pattern (okfRepoOps
// .exportRepoZip, round 16 / #80128): revoking the object URL in the SAME
// task as the click can cancel the browser's asynchronous blob snapshot, and
// the download arrives empty or partial.
export function saveBlob(blob, fileName) {
  if (!blob) throw new Error('saveBlob: no blob');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName || 'download';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return fileName;
}
