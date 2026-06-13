import { describe, it, expect } from 'vitest';
import { contentDispositionAttachment } from './http.js';

const ASCII_ONLY = /^[\x20-\x7E]*$/;

describe('contentDispositionAttachment', () => {
  it('passes ASCII filenames through in the quoted fallback', () => {
    const v = contentDispositionAttachment('hatch-report-acme-may-2026-v1.pdf');
    expect(v).toContain('filename="hatch-report-acme-may-2026-v1.pdf"');
    expect(v).toContain("filename*=UTF-8''hatch-report-acme-may-2026-v1.pdf");
  });

  it('produces a header value that is ALWAYS pure ASCII (the bug that 500ed)', () => {
    // en-dash in a multi-month period label previously threw ERR_INVALID_CHAR
    const v = contentDispositionAttachment('hatch-report-site-may-2026-–-june-2026-v1.pdf');
    expect(ASCII_ONLY.test(v)).toBe(true);
    expect(v).toContain('filename="'); // ascii fallback present
    expect(v).toContain("filename*=UTF-8''"); // utf-8 variant present
  });

  it('strips quotes/backslashes from the ASCII fallback', () => {
    const v = contentDispositionAttachment('a"b\\c.pdf');
    const fallback = v.match(/filename="([^"]*)"/)[1];
    expect(fallback).not.toMatch(/["\\]/);
  });

  it('handles empty/nullish input', () => {
    expect(contentDispositionAttachment(undefined)).toContain('filename="download"');
  });
});
