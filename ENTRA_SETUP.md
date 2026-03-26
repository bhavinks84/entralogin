# Microsoft Entra External ID – Setup Guide

Follow these steps exactly to configure Entra External ID for this project.

---

## 1 – Create an External Tenant

> External ID uses a **separate tenant** from your workforce (employee) Azure AD. Do not use your main Azure tenant.

1. Go to [https://entra.microsoft.com](https://entra.microsoft.com) and sign in with a Microsoft account.
2. In the left sidebar, click **"Microsoft Entra ID"** → **"Overview"** → **"Manage tenants"**.
3. Click **"+ Create"**.
4. Choose **"External"** (NOT "Workforce") and click **Next: Configuration**.
5. Fill in:
   - **Organization name**: e.g. `My App External`
   - **Initial domain name**: e.g. `myapp` → becomes `myapp.onmicrosoft.com`
   - **Country/Region**: Your region
6. Click **Review + Create**, then **Create**.
7. Wait ~1 minute for the tenant to provision, then click **"Switch to the new tenant"**.

---

## 2 – Enable "Email with one-time passcode" Identity Provider

1. In your **External** tenant, go to:
   **Home → External Identities → All identity providers**
2. Click **"Email one-time passcode"**.
3. Set it to **"Enabled"** and save.

---

## 3 – Register Your Application

1. Go to **App registrations → New registration**.
2. Fill in:
   - **Name**: `EntraLogin Web App`
   - **Supported account types**: **"Accounts in this organizational directory only"**
   - **Redirect URI**:
     - Platform: **Web**
     - URI: `http://localhost:5000/api/auth/entra/callback`
3. Click **Register**.
4. Note down **Application (client) ID** → this is `ENTRA_CLIENT_ID`.
5. Note down **Directory (tenant) ID** → this is `ENTRA_TENANT_ID`.
6. Note the **subdomain** from your tenant domain `<subdomain>.onmicrosoft.com` → this is `ENTRA_TENANT_SUBDOMAIN`.

### Create a Client Secret

1. In the app registration, go to **Certificates & secrets → New client secret**.
2. Add a description (e.g. `dev`), choose an expiry (24 months), click **Add**.
3. **Copy the secret Value immediately** — it won't be shown again.
4. This is `ENTRA_CLIENT_SECRET`.

### Add Front-Channel Logout URL

1. Go to **Authentication** in the app registration.
2. Under **Front-channel logout URL**, enter: `http://localhost:3000`
3. Save.

---

## 4 – Create a User Flow (Sign-up / Sign-in)

1. Go to **External Identities → User flows → New user flow**.
2. Choose **"Sign up and sign in"** and click **Create**.
3. **Name**: `B2C_1_signupsignin` (Azure will prefix it; note the full name).

4. Under **Identity providers**, check:
   - ✅ **Email with one-time passcode**
   - ✅ **Microsoft Account** (optional – for personal accounts)

5. Under **User attributes**, select:
   - ✅ Email address
   - ✅ Display name
   - ✅ Given name
   - ✅ Surname

6. Click **Create**.

### Link the User Flow to Your App

1. Open the user flow you just created.
2. Click **Applications → Add application**.
3. Select **EntraLogin Web App** and save.

---

## 5 – Configure API Permissions

1. In your app registration → **API permissions → Add a permission**.
2. Choose **Microsoft Graph → Delegated permissions**, add:
   - `openid`
   - `profile`
   - `email`
   - `offline_access`
3. Now add **Application permissions** (not Delegated) for back-end Graph calls:
   - Click **Add a permission → Microsoft Graph → Application permissions**
   - Search for and add: **`User.ReadWrite.All`**
   - This allows the backend to create and look up users in Entra on behalf of the app
     (used when someone registers via Email OTP — their account is automatically
     provisioned in Entra External ID).
4. Click **Grant admin consent for [your org]** (requires Global Admin).
   Both delegated and application permissions must show a green ✓ checkmark.

---

## 6 – Update Your `.env` File

```env
ENTRA_CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
ENTRA_CLIENT_SECRET=your-secret-value
ENTRA_TENANT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
ENTRA_TENANT_SUBDOMAIN=myapp
ENTRA_REDIRECT_URI=http://localhost:5000/api/auth/entra/callback
```

The MSAL authority URL constructed in code will be:
```
https://<ENTRA_TENANT_SUBDOMAIN>.ciamlogin.com/<ENTRA_TENANT_ID>
```

---

## 7 – Production Checklist

| Item | Action |
|------|--------|
| Redirect URI | Add your production URI in the app registration |
| Front-channel logout | Update to your production frontend URL |
| `NODE_ENV=production` | Set in your deployment environment |
| Rotate `JWT_SECRET` and `JWT_REFRESH_SECRET` | Use 64+ char random strings |
| SMTP provider | Replace Ethereal with SendGrid, AWS SES, etc. |
| HTTPS | Enforce on all cookies (`secure: true`) |
| Custom domain | Optional – configure in Entra External ID settings |
