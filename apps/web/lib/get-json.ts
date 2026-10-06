// A 401/403 body is an error object, not the list a page expects, and a `data = []` default only covers
// undefined — so `.filter`/`.find` on it threw and `(app)/error.tsx` painted its "404" screen (a doctor
// can't read /health-plans). Throwing keeps `data` undefined so the defaults apply.
export const getJson = (url: string) =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error(`${r.status} ${url}`);
    return r.json();
  });
