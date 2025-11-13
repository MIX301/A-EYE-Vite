## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## iPhone over LAN (HTTPS)

1. mkcert certificates (Mac):
   - `brew install mkcert`
   - `mkcert -install`
   - `mkdir -p certs`
   - `mkcert -key-file certs/dev.key -cert-file certs/dev.crt 192.168.x.x my-mac.local`
2. Trust Root CA on iPhone:
   - `open $(mkcert -CAROOT)` → AirDrop `rootCA.pem` to iPhone → install & trust (Settings → General → About → Certificate Trust Settings).
3. Optional HMR host: `export LAN_HOST=192.168.x.x` (or add to `.env.local`).
4. Start dev server: `npm run dev` and open `https://192.168.x.x:3000` in iPhone Safari.
5. Allow camera/mic, tap Start to unlock audio, then Share → Add to Home Screen.

 

(base) eirvav@Eiriks-MacBook-Pro-2 ~ % mkdir -p certs

(base) eirvav@Eiriks-MacBook-Pro-2 ~ % mkcert -key-file certs/dev.key -cert-file certs/dev.crt 192.168.1.50 my-mac.local

Created a new certificate valid for the following names 📜
 - "192.168.1.50"
 - "my-mac.local"

The certificate is at "certs/dev.crt" and the key at "certs/dev.key" ✅

It will expire on 15 January 2028 🗓

