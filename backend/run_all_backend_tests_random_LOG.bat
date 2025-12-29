@echo off
setlocal EnableExtensions

REM ============================================================
REM TowMech Backend Full Automated Test Pack (Robust v2)
REM - curl output -> temp file
REM - PowerShell parses JSON using Get-Content -Raw
REM - Logs all request/response
REM ============================================================

set "BASE=http://localhost:5000"

for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd_HHmmss"') do set "TS=%%i"
set "LOG=test_log_%TS%.txt"

set "TMPDIR=%TEMP%\towmech_tests"
if not exist "%TMPDIR%" mkdir "%TMPDIR%"

set "RESP=%TMPDIR%\resp.json"
set "ERR=%TMPDIR%\err.txt"

echo ✅ Logging to: %LOG%
echo ===== TowMech Full Test Run %TS% =====> "%LOG%"
echo BASE=%BASE%>> "%LOG%"
echo.>> "%LOG%"

call :log "STEP 0 - Health check"
call :curl GET "%BASE%/health" "" ""
call :log "Health response: %RESPONSE%"
echo %RESPONSE% | findstr /C:"ok" >nul
if errorlevel 1 (
  call :log "❌ Health failed. Make sure server is running: npm run dev"
  exit /b 1
)

REM Randomize
set "RND=%RANDOM%%RANDOM%"
set "SUPER_EMAIL=superadmin@test.com"
set "SUPER_PASS=123456"

set "ADMIN_EMAIL=admin_%RND%@test.com"
set "ADMIN_PASS=123456"

set "LIMITED_ADMIN_EMAIL=admin_limited_%RND%@test.com"
set "LIMITED_ADMIN_PASS=123456"

set "CUSTOMER_EMAIL=customer_%RND%@test.com"
set "CUSTOMER_PASS=123456"

set "PROVIDER_EMAIL=tow_%RND%@test.com"
set "PROVIDER_PASS=123456"

REM STEP 1 Ensure SuperAdmin (optional)
call :log "STEP 1 - Ensure SuperAdmin exists (optional)"
if exist "src\scripts\createSuperAdmin.js" (
  call :log "Running node src\scripts\createSuperAdmin.js"
  node src\scripts\createSuperAdmin.js >> "%LOG%" 2>&1
) else (
  call :log "No createSuperAdmin.js found. Skipping."
)

REM STEP 2 Super login -> OTP
call :log "STEP 2 - SuperAdmin login (OTP)"
call :curl POST "%BASE%/api/auth/login" "{\"email\":\"%SUPER_EMAIL%\",\"password\":\"%SUPER_PASS%\"}" "Content-Type: application/json"
call :jsonGet otp SUPER_OTP
if "%SUPER_OTP%"=="" (
  call :log "❌ SuperAdmin OTP missing. Ensure ENABLE_OTP_DEBUG=true in .env and restart server."
  exit /b 1
)
call :log "Super OTP: %SUPER_OTP%"

REM STEP 3 Verify OTP -> token
call :log "STEP 3 - SuperAdmin verify OTP"
call :curl POST "%BASE%/api/auth/verify-otp" "{\"email\":\"%SUPER_EMAIL%\",\"otp\":\"%SUPER_OTP%\"}" "Content-Type: application/json"
call :jsonGet token SUPER_TOKEN
if "%SUPER_TOKEN%"=="" (
  call :log "❌ Super token missing."
  exit /b 1
)
call :log "Super token OK"

REM STEP 4 Create full-permission admin
call :log "STEP 4 - Create Admin (%ADMIN_EMAIL%)"
call :curl POST "%BASE%/api/superadmin/create-admin" "{\"name\":\"Admin Auto\",\"email\":\"%ADMIN_EMAIL%\",\"password\":\"%ADMIN_PASS%\",\"permissions\":{\"canManageUsers\":true,\"canManagePricing\":true,\"canViewStats\":true,\"canVerifyProviders\":true}}" "Content-Type: application/json|Authorization: Bearer %SUPER_TOKEN%"
call :jsonGet "admin.id" ADMIN_ID
if "%ADMIN_ID%"=="" (
  call :log "❌ Admin ID missing (create admin failed)."
  exit /b 1
)
call :log "Admin created: %ADMIN_ID%"

REM STEP 5 Admin login/verify -> token
call :log "STEP 5 - Admin login (OTP)"
call :curl POST "%BASE%/api/auth/login" "{\"email\":\"%ADMIN_EMAIL%\",\"password\":\"%ADMIN_PASS%\"}" "Content-Type: application/json"
call :jsonGet otp ADMIN_OTP
if "%ADMIN_OTP%"=="" (
  call :log "❌ Admin OTP missing."
  exit /b 1
)

call :log "STEP 5b - Admin verify OTP"
call :curl POST "%BASE%/api/auth/verify-otp" "{\"email\":\"%ADMIN_EMAIL%\",\"otp\":\"%ADMIN_OTP%\"}" "Content-Type: application/json"
call :jsonGet token ADMIN_TOKEN
if "%ADMIN_TOKEN%"=="" (
  call :log "❌ Admin token missing."
  exit /b 1
)
call :log "Admin token OK"

REM STEP 6 Register customer + login/verify
call :log "STEP 6 - Register Customer (%CUSTOMER_EMAIL%)"
call :curl POST "%BASE%/api/auth/register" "{\"name\":\"Customer Auto\",\"email\":\"%CUSTOMER_EMAIL%\",\"password\":\"%CUSTOMER_PASS%\",\"role\":\"Customer\"}" "Content-Type: application/json"
call :jsonGet "user.id" CUSTOMER_ID
if "%CUSTOMER_ID%"=="" (
  call :log "❌ Customer ID missing."
  exit /b 1
)
call :log "Customer ID: %CUSTOMER_ID%"

call :log "STEP 6b - Customer login (OTP)"
call :curl POST "%BASE%/api/auth/login" "{\"email\":\"%CUSTOMER_EMAIL%\",\"password\":\"%CUSTOMER_PASS%\"}" "Content-Type: application/json"
call :jsonGet otp CUST_OTP
if "%CUST_OTP%"=="" (
  call :log "❌ Customer OTP missing."
  exit /b 1
)

call :log "STEP 6c - Customer verify OTP"
call :curl POST "%BASE%/api/auth/verify-otp" "{\"email\":\"%CUSTOMER_EMAIL%\",\"otp\":\"%CUST_OTP%\"}" "Content-Type: application/json"
call :jsonGet token CUSTOMER_TOKEN
if "%CUSTOMER_TOKEN%"=="" (
  call :log "❌ Customer token missing."
  exit /b 1
)

REM STEP 7 Register provider + login/verify
call :log "STEP 7 - Register Provider (%PROVIDER_EMAIL%)"
call :curl POST "%BASE%/api/auth/register" "{\"name\":\"Tow Auto\",\"email\":\"%PROVIDER_EMAIL%\",\"password\":\"%PROVIDER_PASS%\",\"role\":\"TowTruck\"}" "Content-Type: application/json"
call :jsonGet "user.id" PROVIDER_ID
if "%PROVIDER_ID%"=="" (
  call :log "❌ Provider ID missing."
  exit /b 1
)
call :log "Provider ID: %PROVIDER_ID%"

call :log "STEP 7b - Provider login (OTP)"
call :curl POST "%BASE%/api/auth/login" "{\"email\":\"%PROVIDER_EMAIL%\",\"password\":\"%PROVIDER_PASS%\"}" "Content-Type: application/json"
call :jsonGet otp PROV_OTP
if "%PROV_OTP%"=="" (
  call :log "❌ Provider OTP missing."
  exit /b 1
)

call :log "STEP 7c - Provider verify OTP"
call :curl POST "%BASE%/api/auth/verify-otp" "{\"email\":\"%PROVIDER_EMAIL%\",\"otp\":\"%PROV_OTP%\"}" "Content-Type: application/json"
call :jsonGet token PROVIDER_TOKEN
if "%PROVIDER_TOKEN%"=="" (
  call :log "❌ Provider token missing."
  exit /b 1
)

REM STEP 8 Approve provider (NOTE: your adminProviders routes currently include "/providers/...")
call :log "STEP 8 - Admin approves provider"
call :curl PATCH "%BASE%/api/admin/providers/providers/%PROVIDER_ID%/approve" "" "Authorization: Bearer %ADMIN_TOKEN%"
call :log "Approve provider response: %RESPONSE%"

REM STEP 9 suspend/unsuspend
call :log "STEP 9 - Admin suspend customer"
call :curl PATCH "%BASE%/api/admin/users/%CUSTOMER_ID%/suspend" "{\"reason\":\"Fraud suspected\"}" "Content-Type: application/json|Authorization: Bearer %ADMIN_TOKEN%"

call :log "STEP 9b - Admin unsuspend customer"
call :curl PATCH "%BASE%/api/admin/users/%CUSTOMER_ID%/unsuspend" "" "Authorization: Bearer %ADMIN_TOKEN%"

REM STEP 10 ban/unban
call :log "STEP 10 - Admin ban customer"
call :curl PATCH "%BASE%/api/admin/users/%CUSTOMER_ID%/ban" "{\"reason\":\"Chargebacks\"}" "Content-Type: application/json|Authorization: Bearer %ADMIN_TOKEN%"

call :log "STEP 10b - Admin unban customer"
call :curl PATCH "%BASE%/api/admin/users/%CUSTOMER_ID%/unban" "" "Authorization: Bearer %ADMIN_TOKEN%"

REM STEP 11 archive (SuperAdmin only)
call :log "STEP 11 - SuperAdmin archive customer"
call :curl PATCH "%BASE%/api/admin/users/%CUSTOMER_ID%/archive" "" "Authorization: Bearer %SUPER_TOKEN%"

REM STEP 12 stats + pricing
call :log "STEP 12 - Admin statistics test"
call :curl GET "%BASE%/api/admin/statistics?period=1h" "" "Authorization: Bearer %ADMIN_TOKEN%"

call :log "STEP 12b - Pricing config GET"
call :curl GET "%BASE%/api/pricing-config" "" ""

call :log "STEP 12c - Pricing config PATCH"
call :curl PATCH "%BASE%/api/pricing-config" "{\"baseFee\":55}" "Content-Type: application/json|Authorization: Bearer %ADMIN_TOKEN%"

REM STEP 13 negative test: limited admin cannot manage users
call :log "STEP 13 - Create LIMITED admin (%LIMITED_ADMIN_EMAIL%)"
call :curl POST "%BASE%/api/superadmin/create-admin" "{\"name\":\"Admin Limited\",\"email\":\"%LIMITED_ADMIN_EMAIL%\",\"password\":\"%LIMITED_ADMIN_PASS%\",\"permissions\":{\"canManageUsers\":false,\"canManagePricing\":true,\"canViewStats\":true,\"canVerifyProviders\":true}}" "Content-Type: application/json|Authorization: Bearer %SUPER_TOKEN%"

call :log "STEP 13b - Limited admin login/verify"
call :curl POST "%BASE%/api/auth/login" "{\"email\":\"%LIMITED_ADMIN_EMAIL%\",\"password\":\"%LIMITED_ADMIN_PASS%\"}" "Content-Type: application/json"
call :jsonGet otp LADMIN_OTP
call :curl POST "%BASE%/api/auth/verify-otp" "{\"email\":\"%LIMITED_ADMIN_EMAIL%\",\"otp\":\"%LADMIN_OTP%\"}" "Content-Type: application/json"
call :jsonGet token LADMIN_TOKEN

call :log "STEP 13c - Limited admin tries suspend (should fail)"
call :curl PATCH "%BASE%/api/admin/users/%CUSTOMER_ID%/suspend" "{\"reason\":\"Should fail\"}" "Content-Type: application/json|Authorization: Bearer %LADMIN_TOKEN%"

call :log "✅ ALL TESTS COMPLETED"
call :log "Log saved: %LOG%"
echo.
echo ✅ Done. Log: %LOG%
exit /b 0

REM ============================================================
REM curl helper: call :curl METHOD URL JSONBODY HEADERS
REM headers format: "Header: v|Header2: v2"
REM ============================================================
:curl
set "METHOD=%~1"
set "URL=%~2"
set "BODY=%~3"
set "HEADERS=%~4"

del /q "%RESP%" "%ERR%" >nul 2>&1

set "HARGS="

if not "%HEADERS%"=="" (
  for %%H in (%HEADERS:^|= %) do (
    set "HARGS=!HARGS! -H ""%%~H"""
  )
)

REM Use PowerShell to run curl with proper quoting
powershell -NoProfile -Command ^
  "$m='%METHOD%'; $u='%URL%'; $b='%BODY%';" ^
  "$h='%HEADERS%'.Split('|') | Where-Object { $_ -and $_.Trim() -ne '' };" ^
  "$args=@('-s','-X',$m,$u);" ^
  "foreach($x in $h){ $args += @('-H',$x) }" ^
  "if($b -and $b -ne ''){ $args += @('-d',$b) }" ^
  "$out = & curl.exe @args 2>&1;" ^
  "Set-Content -Path '%RESP%' -Value $out -Encoding utf8NoBOM;" >nul 2>&1

for /f "usebackq delims=" %%A in (C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile -Command "(Get-Content -Raw '%RESP%').Trim()") do set "RESPONSE=%%A"

call :log "REQUEST: %METHOD% %URL%"
if not "%BODY%"=="" call :log "BODY: %BODY%"
if not "%HEADERS%"=="" call :log "HEADERS: %HEADERS%"
call :log "RESPONSE: %RESPONSE%"
call :log "----"
exit /b 0

REM ============================================================
REM jsonGet helper: call :jsonGet keypath OUTVAR
REM keypath examples: otp, token, user.id, admin.id
REM ============================================================
:jsonGet
set "KEY=%~1"
set "OUTVAR=%~2"
for /f "usebackq delims=" %%A in (`powershell -NoProfile -Command ^
  "$raw = Get-Content -Raw '%RESP%';" ^
  "try { $j = $raw | ConvertFrom-Json } catch { '' ; exit }" ^
  "$k='%KEY%'.Split('.');" ^
  "$v=$j;" ^
  "foreach($p in $k){ if($null -eq $v){ break } ; $v = $v.$p }" ^
  "if($v){ $v }"`) do set "%OUTVAR%=%%A"
exit /b 0

:log
echo [%DATE% %TIME%] %~1
echo [%DATE% %TIME%] %~1>> "%LOG%"
exit /b 0