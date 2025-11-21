# Deployment Guide

## 🚀 Quick Deploy Steps

### 1. Deploy Backend to Railway

Your PostgreSQL database is already on Railway! Now let's deploy the backend:

1. **Go to Railway**: https://railway.app
2. **Create New Project** → "Deploy from GitHub repo"
3. **Select**: `eddiemorillas-blip/preseason-ordering`
4. **Configure**:
   - Root Directory: `/` (leave as root)
   - Build Command: `npm install`
   - Start Command: `npm start`

5. **Add Environment Variables**:
   - Click on your service → Variables tab
   - Add these variables:
     ```
     DATABASE_URL=${DATABASE_URL}  (should already be connected from your existing database)
     JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
     NODE_ENV=production
     PORT=5000
     ```

6. **Generate Domain**:
   - Go to Settings → Networking
   - Click "Generate Domain"
   - **Save this URL!** You'll need it for the frontend

### 2. Deploy Frontend to Vercel

1. **Go to Vercel**: https://vercel.com
2. **Add New Project** → Import from GitHub
3. **Select**: `eddiemorillas-blip/preseason-ordering`
4. **Configure**:
   - Framework Preset: **Vite**
   - Root Directory: `frontend`
   - Build Command: `npm run build`
   - Output Directory: `dist`

5. **Add Environment Variables**:
   - Add this variable with your Railway backend URL:
     ```
     VITE_API_URL=https://your-railway-app-url.railway.app/api
     ```

6. **Deploy!**
   - Click Deploy
   - Vercel will give you a live URL

### 3. Update Frontend API Configuration

After deployment, update your frontend to use the production API URL:

Edit `frontend/src/services/api.js` to use environment variables properly.

### 4. Test Your App

1. Visit your Vercel frontend URL
2. Try logging in or registering
3. Test all features

## 🔒 Security Checklist

- [ ] Change JWT_SECRET to a strong random value
- [ ] Verify .env is in .gitignore (it is!)
- [ ] Test all API endpoints
- [ ] Set up CORS properly for your frontend domain
- [ ] Add your team members to Railway and Vercel projects

## 📝 Notes

- Every push to `main` branch will auto-deploy to both Railway and Vercel
- View logs in Railway/Vercel dashboards
- Your database is persistent and already set up
