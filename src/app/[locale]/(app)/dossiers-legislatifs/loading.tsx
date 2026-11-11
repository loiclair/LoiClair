export default function DossiersLoading() {
  // No skeleton needed — the default view (quick links) renders instantly
  // via early return in page.tsx without any database queries.
  // When filters are active, Next.js streams the server content progressively.
  return null;
}
