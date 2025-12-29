@echo off
setlocal enabledelayedexpansion

REM ✅ BASE URL
set "BASE=http://localhost:5000"

REM ✅ Safe timestamp using PowerShell (no / or :)
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd_HHmmss"') do set "TS=%%i"

REM ✅ Log file (safe name)
set "LOGFILE=test_log_%TS%.txt"

echo ============================================ > "%LOGFILE%"
echo ✅ TowMech FULL AUTO TEST SCRIPT STARTING... >> "%LOGFILE%"
echo BASE: %BASE% >> "%LOGFILE%"
echo LOGFILE: %LOGFILE% >> "%LOGFILE%"
echo ============================================ >> "%LOGFILE%"

echo.
echo ✅ Logging to: %LOGFILE%
echo.

REM ✅ Random Unique Suffix
set "RAND=%RANDOM%"
set "ADMIN_EMAIL=admin_%TS%_%RAND%@test.com"
set "CUSTOMER_EMAIL=customer_%TS%_%RAND%@test.com"

echo ADMIN EMAIL: %ADMIN_EMAIL% >> "%LOGFILE%"
echo CUSTOMER EMAIL: %CUSTOMER_EMAIL% >> "%LOGFILE%"

REM =========================================================
REM ✅ STEP 1: SUPERADMIN LOGIN → GET OTP
REM =========================================================
echo. >> "%LOGFILE%"
echo ✅ STEP 1: SuperAdmin LOGIN >> "%LOGFILE%"

for /f "delims=" %%A in ('curl -s -X POST %BASE%/api/auth/login ^
 -H "Content-Type: application/json" ^
 -d "{\"email\":\"superadmin@test.com\",\"password\":\"123456\"}"') do set "SUPER_LOGIN_RESPONSE=%%A"

echo Response: !SUPER_LOGIN_RESPONSE! >> "%LOGFILE%"
echo ✅ Step 1 Response: !SUPER_LOGIN_RESPONSE!

echo !SUPER_LOGIN_RESPONSE! | findstr /R "\"otp\"" >nul || (
  echo ❌ Step 1 Failed: OTP not generated >> "%LOGFILE%"
  echo ❌ Step 1 Failed: OTP not generated
  echo (Tip: ensure ENABLE_OTP_DEBUG=true in .env) >> "%LOGFILE%"
  exit /b 1
)

for /f "tokens=2 delims=:" %%B in ('echo !SUPER_LOGIN_RESPONSE! ^| findstr /R "\"otp\""') do set "SUPER_OTP=%%B"
set "SUPER_OTP=!SUPER_OTP:"=!"
set "SUPER_OTP=!SUPER_OTP:,=!"
set "SUPER_OTP=!SUPER_OTP: =!"

echo ✅ Extracted Super OTP: !SUPER_OTP! >> "%LOGFILE%"

REM =========================================================
REM ✅ STEP 2: SUPERADMIN VERIFY OTP → GET TOKEN
REM =========================================================
echo. >> "%LOGFILE%"
echo ✅ STEP 2: SuperAdmin VERIFY OTP >> "%LOGFILE%"

for /f "delims=" %%A in ('curl -s -X POST %BASE%/api/auth/verify-otp ^
 -H "Content-Type: application/json" ^
 -d "{\"email\":\"superadmin@test.com\",\"otp\":\"!SUPER_OTP!\"}"') do set "SUPER_VERIFY_RESPONSE=%%A"

echo Response: !SUPER_VERIFY_RESPONSE! >> "%LOGFILE%"
echo ✅ Step 2 Response: !SUPER_VERIFY_RESPONSE!

echo !SUPER_VERIFY_RESPONSE! | findstr /R "\"token\"" >nul || (
  echo ❌ Step 2 Failed: token missing >> "%LOGFILE%"
  echo ❌ Step 2 Failed: token missing
  exit /b 1
)

for /f "tokens=2 delims=:" %%B in ('echo !SUPER_VERIFY_RESPONSE! ^| findstr /R "\"token\""') do set "SUPER_TOKEN=%%B"
set "SUPER_TOKEN=!SUPER_TOKEN:"=!"
set "SUPER_TOKEN=!SUPER_TOKEN:,=!"
set "SUPER_TOKEN=!SUPER_TOKEN: =!"

echo ✅ SuperAdmin Token Saved ✅ >> "%LOGFILE%"

REM =========================================================
REM ✅ STEP 3: CREATE ADMIN
REM =========================================================
echo. >> "%LOGFILE%"
echo ✅ STEP 3: Create Admin >> "%LOGFILE%"

for /f "delims=" %%A in ('curl -s -X POST %BASE%/api/superadmin/create-admin ^
 -H "Content-Type: application/json" ^
 -H "Authorization: Bearer !SUPER_TOKEN!" ^
 -d "{\"name\":\"Admin Auto\",\"email\":\"%ADMIN_EMAIL%\",\"password\":\"123456\",\"permissions\":{\"canManageUsers\":true,\"canManagePricing\":true,\"canViewStats\":true,\"canVerifyProviders\":true}}"
') do set "CREATE_ADMIN_RESPONSE=%%A"

echo Response: !CREATE_ADMIN_RESPONSE! >> "%LOGFILE%"
echo ✅ Step 3 Response: !CREATE_ADMIN_RESPONSE!

REM =========================================================
REM ✅ SUMMARY
REM =========================================================
echo. >> "%LOGFILE%"
echo ============================================ >> "%LOGFILE%"
echo ✅ SCRIPT FINISHED ✅ >> "%LOGFILE%"
echo ============================================ >> "%LOGFILE%"
echo Admin Email: %ADMIN_EMAIL% >> "%LOGFILE%"
echo Customer Email: %CUSTOMER_EMAIL% >> "%LOGFILE%"

echo.
echo ✅ Done. Log saved as: %LOGFILE%
pause