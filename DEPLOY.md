# Deploy · TFG Flood Risk Framework

Two-host deploy: **Vercel** (frontend) + **Render** (backend Docker).
Auto-deploy on `git push origin main` → both services rebuild.

---

## TL;DR

1. Push the repo to GitHub.
2. Connect Vercel → frontend goes live in ~40 s.
3. Connect Render → backend goes live in ~5 min.
4. Set the cross-references (Vercel knows backend URL, Render knows
   Vercel domain for CORS).
5. Share the Vercel URL.

---

## 1 · Repo on GitHub

```bash
# At the repo root (tfg-earth-intelligence/)
git init
git add .
git commit -m "Initial commit · TFG Flood Risk Framework"

# Create an empty repo on github.com first (no README, no .gitignore).
# Then:
git remote add origin git@github.com:<your-username>/tfg-flood-risk.git
git branch -M main
git push -u origin main
```

The repo includes:

- `framework_web/backend/` — FastAPI service + Dockerfile
- `framework_web/frontend/` — React app + `vercel.json`
- `models/random_forest_v2.joblib` (23 MB) — production model
- `framework_web/backend/data_processed/` (49 MB) — geojsons + lookups

`.gitignore` excludes raw Sentinel scenes, venvs, build artifacts.

---

## 2 · Backend on Render

### 2a — Create the service

1. <https://dashboard.render.com> → **New** → **Web Service**.
2. Connect the GitHub repo `tfg-flood-risk`.
3. Settings:
   - **Name**: `tfg-flood-backend`
   - **Region**: Frankfurt (closer to Spain)
   - **Branch**: `main`
   - **Runtime**: **Docker**
   - **Dockerfile Path**: `framework_web/backend/Dockerfile`
   - **Docker Context**: `.` (repo root — the Dockerfile copies from `framework_web/...` and `models/...`)
   - **Instance Type**: Free (cold starts ~30-60 s after 15 min idle) or
     Starter $7/mo (always on).
4. **Environment Variables**:
   - `DEBUG` = `false`
   - `CORS_ORIGINS` = `https://<your-vercel-project>.vercel.app`
     (single domain, comma-separated for multiple — accepts JSON too)
   - `PORT` is set automatically by Render.
5. **Health Check Path**: `/api/health`.
6. Click **Create Web Service**. First build ≈ 5 min.

You get a URL like `https://tfg-flood-backend.onrender.com`. Test:

```bash
curl https://tfg-flood-backend.onrender.com/api/health
# {"status":"ok","model_loaded":true,...}
```

### 2b — Updating CORS later

If Vercel gives you a different production domain (or you add
preview URLs), edit the `CORS_ORIGINS` env var in Render dashboard and
trigger a redeploy. No code change required.

---

## 3 · Frontend on Vercel

### 3a — Create the project

1. <https://vercel.com/new> → import the GitHub repo.
2. **Framework Preset**: Vite (auto-detected).
3. **Root Directory**: `framework_web/frontend` ⚠️ (Vercel needs this)
4. **Build / Install / Output**: leave default — `vercel.json` overrides them.
5. **Environment Variables** (before first deploy):
   - `VITE_API_BASE_URL` = `https://tfg-flood-backend.onrender.com`
     (the Render URL from step 2a, **without trailing slash**)
6. Click **Deploy**. First build ≈ 40 s.

You get a URL like `https://tfg-flood-risk.vercel.app`.

### 3b — Custom domain (optional)

If you want a memorable URL, Settings → Domains → add your own.
Vercel handles HTTPS automatically.

---

## 4 · Cross-references

Wire the two services together — each needs to know the other's URL.

| Service  | Env var              | Value                                          |
| -------- | -------------------- | ---------------------------------------------- |
| Vercel   | `VITE_API_BASE_URL`  | `https://tfg-flood-backend.onrender.com`       |
| Render   | `CORS_ORIGINS`       | `https://tfg-flood-risk.vercel.app`            |

Both env-var changes require a redeploy:

- **Vercel**: edit → Project → Settings → Environment Variables, then
  Deployments → Redeploy latest.
- **Render**: edit → Service → Environment, then Manual Deploy → "Clear
  build cache & deploy".

---

## 5 · The auto-deploy loop

After the initial setup, the workflow is:

```bash
# Edit code locally → test
git add .
git commit -m "feat: new KPI on Exposure Dashboard"
git push origin main
```

1. Vercel detects the push → rebuilds frontend in ~40 s → live.
2. Render detects the push → rebuilds Docker image in ~3-5 min → live.
3. The URLs (`*.vercel.app`, `*.onrender.com`) stay the same.

Ricard and José just need the **Vercel URL**. Refresh after a push and
they see the change.

---

## 6 · First-time test for tutors

Send Ricard this one line:

> "Resumen del TFG: `https://tfg-flood-risk.vercel.app` · si el backend
> está dormido la primera carga tarda 30-60 s, después es instantáneo."

The "dormido" caveat is only true on Render's free tier. Upgrading to
Starter ($7/mo) removes it.

---

## 7 · Troubleshooting

| Symptom                                | Likely cause                                              | Fix                                                                                |
| -------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Frontend loads, every API call 503     | Render backend is asleep (free tier cold start)           | Wait 30-60 s and refresh. Or upgrade to Starter.                                   |
| CORS error in browser console          | `CORS_ORIGINS` doesn't include the Vercel domain          | Add it on Render dashboard, redeploy. Wildcards like `https://*.vercel.app` ok.    |
| `model_loaded: false` on `/api/health` | Joblib failed to load in Docker                           | Check Render logs. Most common: model file missing because `.dockerignore` excluded it (it shouldn't — we only exclude `_DEPRECATED` + `xgboost`). |
| 404 on `/api/health`                   | Vercel is intercepting `/api/` paths                      | `vercel.json` already excludes `/api/` from the SPA fallback. Verify the file shipped. |
| Vercel build fails on `pnpm install`   | `pnpm-lock.yaml` not committed                            | `git add framework_web/frontend/pnpm-lock.yaml && git commit`                       |

---

## 8 · Local sanity check

Before pushing, verify the Docker build works locally:

```bash
# From the repo root
docker build -t flood-risk-backend -f framework_web/backend/Dockerfile .
docker run --rm -p 8000:8000 -e DEBUG=false flood-risk-backend &
sleep 8
curl http://localhost:8000/api/health
# {"status":"ok","model_loaded":true,...}
```

If this works, the Render build will work.
