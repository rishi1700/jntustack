function parseHeaderParams(value = '') {
  const parts = String(value).split(';').map(part => part.trim());
  const params = {};
  for (const part of parts.slice(1)) {
    const [key, ...rawValue] = part.split('=');
    if (!key) continue;
    params[key.toLowerCase()] = rawValue.join('=').replace(/^"|"$/g, '');
  }
  return params;
}

function parsePartHeaders(rawHeaders) {
  const headers = {};
  for (const line of rawHeaders.split('\r\n')) {
    const index = line.indexOf(':');
    if (index === -1) continue;
    headers[line.slice(0, index).toLowerCase()] = line.slice(index + 1).trim();
  }
  return headers;
}

export async function readRequestBuffer(req, { limitBytes = 25 * 1024 * 1024 } = {}) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limitBytes) {
      throw new Error(`Upload exceeds ${Math.floor(limitBytes / 1024 / 1024)} MB limit.`);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function parseMultipartForm(buffer, contentType) {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  const boundary = match?.[1] || match?.[2];
  if (!boundary) throw new Error('Missing multipart boundary.');

  const body = buffer.toString('latin1');
  const delimiter = `--${boundary}`;
  const fields = {};
  let file = null;

  for (const section of body.split(delimiter)) {
    if (!section || section === '--\r\n' || section === '--') continue;
    const trimmed = section.startsWith('\r\n') ? section.slice(2) : section;
    const headerEnd = trimmed.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;

    const rawHeaders = trimmed.slice(0, headerEnd);
    let content = trimmed.slice(headerEnd + 4);
    if (content.endsWith('\r\n')) content = content.slice(0, -2);
    if (content.endsWith('--')) content = content.slice(0, -2);

    const headers = parsePartHeaders(rawHeaders);
    const disposition = headers['content-disposition'] || '';
    const params = parseHeaderParams(disposition);
    const name = params.name;
    if (!name) continue;

    if (params.filename != null) {
      file = {
        fieldName: name,
        filename: params.filename,
        contentType: headers['content-type'] || 'application/octet-stream',
        buffer: Buffer.from(content, 'latin1'),
      };
    } else {
      fields[name] = content;
    }
  }

  return { fields, file };
}
