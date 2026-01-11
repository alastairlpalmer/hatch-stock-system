# Hatch Stock Management System - Deployment Guide

## Prerequisites

- GitHub account (for deploying from repository)
- Supabase account (you already have this)
- Vercel account (free) - for frontend
- Railway account (free trial, then ~$5/month) - for backend

---

## Step 1: Push Code to GitHub

If you haven't already, create a GitHub repository and push your code:

```bash
# In the Stock Tracker folder
git init
git add .
git commit -m "Initial commit - Hatch Stock Management System"

# Create a new repo on GitHub, then:
git remote add origin https://github.com/YOUR_USERNAME/hatch-stock-system.git
git branch -M main
git push -u origin main
```

---

## Step 2: Deploy Backend to Railway

### 2.1 Create Railway Account
1. Go to [railway.app](https://railway.app)
2. Sign up with GitHub

### 2.2 Create New Project
1. Click **"New Project"**
2. Select **"Deploy from GitHub repo"**
3. Select your repository
4. Choose the `hatch-backend` folder as the root directory

### 2.3 Configure Environment Variables
In Railway dashboard, go to your project → **Variables** tab and add:

| Variable | Value |
|----------|-------|
| `PORT` | `8000` |
| `NODE_ENV` | `production` |
| `DATABASE_URL` | `postgresql://postgres:YOUR_PASSWORD@db.YOUR_PROJECT.supabase.co:5432/postgres` |
| `FRONTEND_URL` | `https://your-app.vercel.app` (update after Vercel deploy) |
| `JWT_SECRET` | `your-secure-random-string` |

### 2.4 Deploy
Railway will automatically deploy. Note your backend URL (e.g., `https://hatch-backend-production.up.railway.app`)

### 2.5 Run Database Migrations
In Railway, go to your service → **Settings** → **Deploy** and add this as a one-time deploy command:
```
npx prisma migrate deploy
```

Or use Railway CLI:
```bash
railway run npx prisma migrate deploy
```

---

## Step 3: Deploy Frontend to Vercel

### 3.1 Create Vercel Account
1. Go to [vercel.com](https://vercel.com)
2. Sign up with GitHub

### 3.2 Import Project
1. Click **"Add New Project"**
2. Import your GitHub repository
3. Configure:
   - **Root Directory**: `hatch-stock-system`
   - **Framework Preset**: Vite

### 3.3 Configure Environment Variables
Add these environment variables:

| Variable | Value |
|----------|-------|
| `VITE_API_URL` | `https://your-backend.railway.app/api` |
| `VITE_DEBUG_MODE` | `false` |

### 3.4 Deploy
Click **"Deploy"** - Vercel will build and deploy your frontend.

---

## Step 4: Update CORS Settings

After both are deployed, update the Railway backend's `FRONTEND_URL` variable:

```
FRONTEND_URL=https://your-app.vercel.app
```

If you have a custom domain later, you can add multiple origins:
```
FRONTEND_URL=https://your-app.vercel.app,https://yourdomain.com
```

---

## Step 5: Connect Custom Domain (Optional)

### For Frontend (Vercel):
1. Go to your Vercel project → **Settings** → **Domains**
2. Add your domain (e.g., `app.yourdomain.com`)
3. Update DNS records as instructed

### For Backend (Railway):
1. Go to your Railway service → **Settings** → **Networking**
2. Add custom domain (e.g., `api.yourdomain.com`)
3. Update DNS records as instructed

---

## Environment Variables Summary

### Backend (Railway)
```env
PORT=8000
NODE_ENV=production
DATABASE_URL=postgresql://postgres:PASSWORD@db.PROJECT.supabase.co:5432/postgres
FRONTEND_URL=https://your-frontend-domain.com
JWT_SECRET=your-secure-secret-key
```

### Frontend (Vercel)
```env
VITE_API_URL=https://your-backend-domain.com/api
VITE_DEBUG_MODE=false
```

---

## Troubleshooting

### CORS Errors
- Make sure `FRONTEND_URL` in Railway includes your Vercel domain
- Check browser console for the blocked origin and add it

### Database Connection Failed
- Verify your Supabase project is active (not paused)
- Check the DATABASE_URL is correctly formatted
- Ensure password special characters are URL-encoded

### Build Failures
- Check Railway/Vercel build logs for specific errors
- Ensure all dependencies are in `package.json`

### API Not Responding
- Check Railway logs for errors
- Verify the `/health` endpoint works: `https://your-backend.railway.app/health`

---

## Estimated Costs

| Service | Free Tier | Paid |
|---------|-----------|------|
| Vercel | Unlimited for hobby | $20/mo for teams |
| Railway | $5 free credit | ~$5-10/mo |
| Supabase | 500MB database | $25/mo for more |
| Domain | - | $10-15/year |

**Total: $0-15/month** (depending on usage)

---

## Quick Deploy Checklist

- [ ] Code pushed to GitHub
- [ ] Backend deployed to Railway
- [ ] Environment variables set in Railway
- [ ] Database migrations run
- [ ] Frontend deployed to Vercel
- [ ] Environment variables set in Vercel
- [ ] CORS updated with correct frontend URL
- [ ] Test the live application
- [ ] (Optional) Custom domain configured
