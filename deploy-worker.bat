@echo off
cd cloudflare-worker
echo ===================================================================
echo   PromptIQ: Cloudflare Workers Deployment
echo ===================================================================
echo.
echo Step 1: Logging in to Cloudflare...
echo (A browser window will open. Log in with your Cloudflare account and click 'Allow')
echo.
call npx --package=wrangler --package=@cloudflare/workerd-windows-64 wrangler login
echo.
echo Step 2: Deploying to Cloudflare Workers edge network...
call npx --package=wrangler --package=@cloudflare/workerd-windows-64 wrangler deploy
echo.
echo ===================================================================
echo   Deployment Complete!
echo   Copy your *.workers.dev URL into PromptIQ extension popup.
echo ===================================================================
pause
