# NIMELSA KDU Chapter — Academic Bank

A plain HTML/CSS/JS site (no build step, no framework, no `node_modules`)
that talks directly to your Supabase project. No accounts, no sign-in —
anyone can browse and submit a resource.

## What's in this folder

- `index.html` — the whole site (one page)
- `style.css` — all styling
- `app.js` — all logic (Supabase calls, upload, search, the intro animation)
- `logo.png` — the NIMELSSA logo, used in the header and footer
- `README.md` — this file

Five files, no folders.

## 1. Deploy it (from your phone, via GitHub)

1. On github.com, create a **new repository**. Keep it Public.
2. Open the repo, tap **Add file → Upload files**.
3. Upload `index.html`, `style.css`, `app.js`, and `logo.png` (README is optional).
4. Commit directly to the `main` branch.
5. Go to **Settings → Pages**.
6. Under "Build and deployment": **Source: Deploy from a branch**,
   **Branch: main / (root)**. Save.
7. Wait about a minute, refresh that Pages settings page for your live URL.

No `npm install`, no environment variables, no build step to fail.

## 2. Removing something after the fact

Uploads go live on the shelf **immediately** — nobody has to approve
anything first. There's still a hidden panel for taking something down
if it's spam, wrong, or shouldn't be there:

1. Go to `yoursite-url/#admin` (add `#admin` to the end of your site's
   address).
2. Sign in with **damilareemmanuelsk@gmail.com** — this account is
   already marked as admin on the backend. If you don't remember its
   password, go to your Supabase dashboard → **Authentication →
   Users**, find that email, open it, and set a new password there.
3. You'll see everything currently on the shelf, each with a
   **Preview file** link and a **Remove from shelf** button.

This page is safe to leave unlinked: even if someone finds the `#admin`
URL, signing in only works for an account with moderator rights — every
other login attempt is rejected by the database itself, not just hidden
by the page.

Want a second person to help moderate? Add them in Supabase dashboard →
**Authentication → Users → Add user** (tick "Auto Confirm User"), then
tell me their email and I'll grant that account moderator rights.

## 3. Why no sign-in

Uploads are open to everyone — no account required, and nothing waits
for approval. That's the tradeoff: maximum ease for whoever's
contributing, in exchange for you occasionally checking the `#admin`
panel and removing anything that shouldn't be there.

## Notes on how it's built

- Auth-free storage and database policies are already set up in your
  Supabase project (`gawqpqunhonuxnzylzvq`): a public storage bucket
  named `resources`, and RLS policies that let anyone submit a pending
  resource but only approved ones are ever publicly visible.
- The intro animation (rolling orb → unzip) and its sound are generated
  entirely in code (CSS + Web Audio API) — nothing to host or 404.
  Visitors with "reduce motion" turned on skip it automatically.
