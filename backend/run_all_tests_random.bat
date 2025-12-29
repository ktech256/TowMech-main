@echo off
setlocal enabledelayedexpansion

REM ✅ BASE URL
set BASE=http://localhost:5000

REM ✅ Random Unique Suffix
set RAND=%RANDOM%
set TIMESTAMP=%DATE:~-4%%DATE:~4,2%%DATE:~7,2%_%TIME:~0,2%%TIME:~3,2%%TIME:~6,2%
set TIMESTAMP=%TIMESTAMP: =0%

set ADMIN_EMAIL=admin_%TIMESTAMP%_%RAND%@test.com
set CUSTOMER_EMAIL=customer_%TIMESTAMP%_%RAND%@test.com

echo ============================================
echo ✅ TowMech FULL AUTO TEST SCRIPT STARTING...
echo BASE: %BASE%
echo ADMIN EMAIL: %ADMIN_EMAIL%
echo CUSTOMER EMAIL: %CUSTOMER_EMAIL%
echo ============================================

REM =========================================================
REM ✅ STEP 1: SUPERADMIN LOGIN → GET OTP
REM =========================================================
echo.
echo ✅ STEP 1: SuperAdmin LOGIN (Generating OTP)...

for /f "delims=" %%A in ('curl -s -X POST %BASE%/api/auth/login ^
 -H "Content-Type: application/json" ^
 -d "{\"email\":\"superadmin@test.com\",\"password\":\"123456\"}"') do set SUPER_LOGIN_RESPONSE=%%A

echo Response: !SUPER_LOGIN_RESPONSE!

for /f "tokens=2 delims=:" %%B in ('echo !SUPER_LOGIN_RESPONSE! ^| findstr /R "\"otp\""') do (
  set SUPER_OTP=%%B
)

set SUPER_OTP=!SUPER_OTP:"=!
set SUPER_OTP=!SUPER_OTP:,=!
set SUPER_OTP=!SUPER_OTP: =!

echo ✅ Extracted Super OTP: !SUPER_OTP!

REM =========================================================
REM ✅ STEP 2: SUPERADMIN VERIFY OTP → GET TOKEN
REM =========================================================
echo.
echo ✅ STEP 2: SuperAdmin VERIFY OTP (Getting token)...

for /f "delims=" %%A in ('curl -s -X POST %BASE%/api/auth/verify-otp ^
 -H "Content-Type: application/json" ^
 -d "{\"email\":\"superadmin@test.com\",\"otp\":\"!SUPER_OTP!\"}"') do set SUPER_VERIFY_RESPONSE=%%A

echo Response: !SUPER_VERIFY_RESPONSE!

for /f "tokens=2 delims=:" %%B in ('echo !SUPER_VERIFY_RESPONSE! ^| findstr /R "\"token\""') do (
  set SUPER_TOKEN=%%B
)

set SUPER_TOKEN=!SUPER_TOKEN:"=!
set SUPER_TOKEN=!SUPER_TOKEN:,=!
set SUPER_TOKEN=!SUPER_TOKEN: =!

echo ✅ SuperAdmin Token Saved ✅

REM =========================================================
REM ✅ STEP 3: CREATE ADMIN (Random Email)
REM =========================================================
echo.
echo ✅ STEP 3: SuperAdmin CREATE ADMIN...

for /f "delims=" %%A in ('curl -s -X POST %BASE%/api/superadmin/create-admin ^
 -H "Content-Type: application/json" ^
 -H "Authorization: Bearer !SUPER_TOKEN!" ^
 -d "{\"name\":\"Admin Auto\",\"email\":\"%ADMIN_EMAIL%\",\"password\":\"123456\",\"permissions\":{\"canManageUsers\":true,\"canManagePricing\":true,\"canViewStats\":true,\"canVerifyProviders\":true}}"
') do set CREATE_ADMIN_RESPONSE=%%A

echo Response: !CREATE_ADMIN_RESPONSE!

for /f "tokens=2 delims=:" %%B in ('echo !CREATE_ADMIN_RESPONSE! ^| findstr /R "\"id\""') do (
  set ADMIN_ID=%%B
  goto :found_admin_id
)

:found_admin_id
set ADMIN_ID=!ADMIN_ID:"=!
set ADMIN_ID=!ADMIN_ID:,=!
set ADMIN_ID=!ADMIN_ID: =!

echo ✅ Admin ID: !ADMIN_ID!

REM =========================================================
REM ✅ STEP 4: ADMIN LOGIN → OTP
REM =========================================================
echo.
echo ✅ STEP 4: Admin LOGIN (Generating OTP)...

for /f "delims=" %%A in ('curl -s -X POST %BASE%/api/auth/login ^
 -H "Content-Type: application/json" ^
 -d "{\"email\":\"%ADMIN_EMAIL%\",\"password\":\"123456\"}"') do set ADMIN_LOGIN_RESPONSE=%%A

echo Response: !ADMIN_LOGIN_RESPONSE!

for /f "tokens=2 delims=:" %%B in ('echo !ADMIN_LOGIN_RESPONSE! ^| findstr /R "\"otp\""') do (
  set ADMIN_OTP=%%B
)

set ADMIN_OTP=!ADMIN_OTP:"=!
set ADMIN_OTP=!ADMIN_OTP:,=!
set ADMIN_OTP=!ADMIN_OTP: =!

echo ✅ Extracted Admin OTP: !ADMIN_OTP!

REM =========================================================
REM ✅ STEP 5: ADMIN VERIFY OTP → TOKEN
REM =========================================================
echo.
echo ✅ STEP 5: Admin VERIFY OTP (Getting token)...

for /f "delims=" %%A in ('curl -s -X POST %BASE%/api/auth/verify-otp ^
 -H "Content-Type: application/json" ^
 -d "{\"email\":\"%ADMIN_EMAIL%\",\"otp\":\"!ADMIN_OTP!\"}"') do set ADMIN_VERIFY_RESPONSE=%%A

echo Response: !ADMIN_VERIFY_RESPONSE!

for /f "tokens=2 delims=:" %%B in ('echo !ADMIN_VERIFY_RESPONSE! ^| findstr /R "\"token\""') do (
  set ADMIN_TOKEN=%%B
)

set ADMIN_TOKEN=!ADMIN_TOKEN:"=!
set ADMIN_TOKEN=!ADMIN_TOKEN:,=!
set ADMIN_TOKEN=!ADMIN_TOKEN: =!

echo ✅ Admin Token Saved ✅

REM =========================================================
REM ✅ STEP 6: CREATE CUSTOMER (Random Email)
REM =========================================================
echo.
echo ✅ STEP 6: Register Customer Auto...

for /f "delims=" %%A in ('curl -s -X POST %BASE%/api/auth/register ^
 -H "Content-Type: application/json" ^
 -d "{\"name\":\"Customer Auto\",\"email\":\"%CUSTOMER_EMAIL%\",\"password\":\"123456\",\"role\":\"Customer\"}"') do set CUSTOMER_RESPONSE=%%A

echo Response: !CUSTOMER_RESPONSE!

for /f "tokens=2 delims=:" %%B in ('echo !CUSTOMER_RESPONSE! ^| findstr /R "\"id\""') do (
  set CUSTOMER_ID=%%B
  goto :found_customer
)

:found_customer
set CUSTOMER_ID=!CUSTOMER_ID:"=!
set CUSTOMER_ID=!CUSTOMER_ID:,=!
set CUSTOMER_ID=!CUSTOMER_ID: =!

echo ✅ Customer ID: !CUSTOMER_ID!

REM =========================================================
REM ✅ STEP 7: ADMIN SUSPEND CUSTOMER
REM =========================================================
echo.
echo ✅ STEP 7: ADMIN Suspend Customer...

curl -s -X PATCH %BASE%/api/admin/users/!CUSTOMER_ID!/suspend ^
 -H "Content-Type: application/json" ^
 -H "Authorization: Bearer !ADMIN_TOKEN!" ^
 -d "{\"reason\":\"Auto Fraud Test\"}"

REM =========================================================
REM ✅ STEP 8: ADMIN UNSUSPEND
REM =========================================================
echo.
echo ✅ STEP 8: ADMIN Unsuspend Customer...

curl -s -X PATCH %BASE%/api/admin/users/!CUSTOMER_ID!/unsuspend ^
 -H "Authorization: Bearer !ADMIN_TOKEN!"

REM =========================================================
REM ✅ STEP 9: ADMIN BAN CUSTOMER
REM =========================================================
echo.
echo ✅ STEP 9: ADMIN Ban Customer...

curl -s -X PATCH %BASE%/api/admin/users/!CUSTOMER_ID!/ban ^
 -H "Content-Type: application/json" ^
 -H "Authorization: Bearer !ADMIN_TOKEN!" ^
 -d "{\"reason\":\"Auto Abuse Test\"}"

REM =========================================================
REM ✅ STEP 10: ADMIN UNBAN CUSTOMER
REM =========================================================
echo.
echo ✅ STEP 10: ADMIN Unban Customer...

curl -s -X PATCH %BASE%/api/admin/users/!CUSTOMER_ID!/unban ^
 -H "Authorization: Bearer !ADMIN_TOKEN!"

REM =========================================================
REM ✅ STEP 11: SUPERADMIN ARCHIVE CUSTOMER
REM =========================================================
echo.
echo ✅ STEP 11: SUPERADMIN Archive Customer...

curl -s -X PATCH %BASE%/api/admin/users/!CUSTOMER_ID!/archive ^
 -H "Authorization: Bearer !SUPER_TOKEN!"

echo.
echo ============================================
echo ✅ ALL TESTS COMPLETED SUCCESSFULLY ✅
echo ============================================

pause