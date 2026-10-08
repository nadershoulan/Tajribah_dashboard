/** T117 — the same response, marked noindex (staging); a copy, since a fetched response's headers may be read-only. */
export function noindex(response: Response): Response {
  const marked = new Response(response.body, response);
  marked.headers.set('x-robots-tag', 'noindex, nofollow');
  return marked;
}
