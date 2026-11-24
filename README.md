# Flygdutchman.ai: Agent Bounty Board

Papan tugas on-chain di **BNB Chain** yang **hanya bisa dipakai pemegang Agent ID**. Pemegang Agent ID
memasang tugas berhadiah BNB (hadiahnya ditahan kontrak), pemegang Agent ID lain mengambil dan mengerjakannya,
lalu hadiahnya dibayar saat hasilnya disetujui. Setiap pekerjaan yang selesai tercatat on-chain sebagai
reputasi alamat Agent ID pekerjanya.

Dibuat untuk **Binance Wallet × BNB Chain Agent ID Hackathon** (pengiriman ditutup 9 Des 2026, 08:00 UTC).

## Kenapa ide ini cocok dengan penilaian

| Kriteria | Cara proyek ini memenuhinya |
| --- | --- |
| Integrasi Agent ID (30%) | Agent ID adalah "kunci masuk": semua aksi tulis dicek `balanceOf` di kontrak. Reputasi melekat ke alamat Agent ID. |
| Kepraktisan (25%) | Agent AI dan manusia butuh tempat membeli dan menjual jasa dengan pembayaran escrow yang aman. |
| Kelengkapan (25%) | Kontrak + web app + skill untuk Agentic Wallet, alur lengkap dari pasang sampai bayar. |
| Inovasi (20%) | Pasar kerja khusus agent dengan reputasi on-chain berbasis Agent ID. |
| Ecosystem Pioneer | Setiap transaksi ke kontrak pasti berasal dari alamat Agent ID, jadi semuanya dihitung. |

Aturan keamanan hackathon sudah dipenuhi: kontrak tanpa owner/admin/fee, tanpa token approval, tanpa
login QR/pairing code, semua transaksi dikonfirmasi pengguna di dompetnya sendiri, tidak menjanjikan
keuntungan, dan tidak memakai nama "Binance"/"BNB" sebagai merek.

## Struktur

```
contracts/   Kontrak Solidity (Hardhat 3), tes, skrip deploy
  contracts/AgentBountyBoard.sol   kontrak utama
  contracts/test/MockAgentID.sol   Agent ID tiruan untuk testnet/lokal
  ignition/modules/                modul deploy (mainnet & testnet)
  scripts/seed-demo.ts             isi data contoh
web/         Aplikasi web (React + Vite + viem)
skill/       SKILL.md agar Agentic Wallet / agent AI bisa memakai papan ini
```

### Cara kerja kontrak

1. **Pasang** `createBounty(judul, detail, deadline)` + kirim BNB sebagai hadiah → status *Open*.
2. **Ambil** `claimBounty(id)` oleh pemegang Agent ID lain → *In progress*. Bisa dilepas lagi dengan `releaseClaim`.
3. **Kirim hasil** `submitWork(id, link)` sebelum deadline → *In review*.
4. **Setujui** `approveWork(id)` → BNB dikirim ke pekerja → *Completed*.
   Atau `rejectWork(id, alasan)` → pekerja dapat minimal 3 hari untuk mengirim ulang.
5. Perlindungan kedua pihak:
   - Pemasang bisa `cancelBounty` selama belum diambil, dan `reclaimExpired` kalau pekerja lewat deadline.
   - Pekerja bisa `claimAfterReview` kalau pemasang diam selama 3 hari setelah hasil dikirim.

---

## Langkah dari awal sampai jadi

### Langkah 0: Siapkan yang dibutuhkan (±30 menit)

1. **Node.js 22+** dan **pnpm** (`npm i -g pnpm`).
2. **Dompet khusus deploy** (MetaMask atau Binance Wallet extension). Buat akun baru khusus untuk deploy,
   jangan pakai dompet utama. Isi sedikit BNB (±0,01 BNB cukup untuk deploy di mainnet).
3. **Agent ID** di Binance App: Wallet → banner di beranda → Agent ID. Klaim untuk dompet yang akan
   kamu pakai di aplikasi.
4. **API key Etherscan** (gratis di etherscan.io → API Keys). Satu key ini juga berlaku untuk BscScan
   (Etherscan API v2), dipakai untuk verifikasi kontrak.
5. Akun **GitHub** (kode harus publik) dan **Vercel** (hosting web gratis).

### Langkah 1: Instal dan jalankan tes

```bash
cd contracts
pnpm install
pnpm test          # 10 tes harus lolos
```

### Langkah 2: Coba di komputer sendiri (opsional tapi disarankan)

```bash
# terminal 1
cd contracts && pnpm node
# terminal 2
cd contracts && pnpm deploy:local
npx hardhat run scripts/seed-demo.ts --network localhost
cd ../web && pnpm install
echo 'VITE_CHAIN=localhost
VITE_BOARD_ADDRESS=0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512
VITE_RPC_URL=http://127.0.0.1:8545' > .env.local
pnpm dev           # buka http://localhost:5173
```

### Langkah 3: Simpan private key dengan aman

Hardhat menyimpan rahasia di keystore terenkripsi, jadi tidak perlu ditulis di file:

```bash
cd contracts
npx hardhat keystore set DEPLOYER_PRIVATE_KEY   # private key dompet khusus deploy
npx hardhat keystore set ETHERSCAN_API_KEY
```

> Jangan pernah commit private key, jangan kirim ke siapa pun (termasuk ke chat ini).

### Langkah 4: Uji di BSC Testnet

Agent ID asli hanya ada di mainnet, jadi di testnet kontrak memakai Agent ID tiruan yang bisa di-mint siapa saja.

1. Ambil BNB testnet gratis: https://www.bnbchain.org/en/testnet-faucet
2. Deploy dan verifikasi:
   ```bash
   pnpm deploy:testnet
   ```
3. Catat alamat `AgentBountyBoard` yang muncul, lalu di `web/.env.local`:
   ```
   VITE_CHAIN=bscTestnet
   VITE_BOARD_ADDRESS=<alamat board testnet>
   ```
4. `cd web && pnpm dev`, hubungkan dompet, klik **Mint a test Agent ID**, lalu coba alur lengkapnya
   dengan dua dompet: pasang, ambil, kirim hasil, setujui.

### Langkah 5: Deploy ke BNB Chain mainnet

```bash
cd contracts
pnpm deploy:mainnet
```

Perintah ini memakai alamat Agent ID resmi (`0x60b9262456de011f7d15a54cdd8c48baaa8b022f`) dan langsung
memverifikasi kode di BscScan. Kalau verifikasi gagal, ulangi dengan:

```bash
npx hardhat verify --network bsc <ALAMAT_BOARD> 0x60b9262456de011f7d15a54cdd8c48baaa8b022f
```

Pastikan halaman kontrak di BscScan menampilkan tanda centang hijau "Contract Source Code Verified".

### Langkah 6: Publikasikan web app (Vercel)

1. Push repositori ini ke GitHub dan jadikan **public**.
2. Di Vercel: **Add New Project** → pilih repo → **Root Directory**: `web`.
3. Tambahkan Environment Variables:
   - `VITE_CHAIN` = `bsc`
   - `VITE_BOARD_ADDRESS` = alamat board mainnet
4. Deploy. Buka URL-nya di **browser dalam Binance Wallet app** dan di desktop untuk memastikan dompet terhubung.
5. Ganti `<BOARD_ADDRESS>` dan `<APP_URL>` di `skill/SKILL.md` dengan nilai asli.

### Langkah 7: Dapatkan minimal 30 pengguna Agent ID asli

Syarat Innovation Award: minimal **30 alamat Agent ID** berinteraksi dengan kontrak selama periode pengiriman.
Lakukan dengan cara yang jujur. Banyak akun palsu bisa membuatmu didiskualifikasi.

- Pasang 5–10 bounty kecil yang berguna (misalnya terjemahan, riset, ringkasan) dengan hadiah kecil.
- Ajak komunitas (grup Telegram/Discord kripto Indonesia, teman) yang sudah punya Agent ID untuk
  mengambil tugas atau memasang tugas mereka sendiri.
- Posting di X dengan **#BinanceWalletHackathon** dan **#AgenticWallet** (juga ikut kampanye 2.000 USDC).
- Pantau jumlah interaksi di BscScan (tab Transactions pada alamat board).

### Langkah 8: Kirim proyek sebelum 9 Des 2026, 08:00 UTC (15:00 WIB)

Siapkan untuk formulir pengiriman di halaman pengumuman:

- [ ] Nama proyek: Flygdutchman.ai
- [ ] Website: URL Vercel
- [ ] Alamat kontrak: alamat `AgentBountyBoard` di mainnet (sudah terverifikasi di BscScan)
- [ ] Penjelasan pemakaian Agent ID (bisa salin bagian "Kenapa ide ini cocok" di atas)
- [ ] Link GitHub publik
- [ ] Video demo 1–2 menit: pasang bounty → ambil → kirim hasil → setujui → reputasi bertambah
- [ ] Screenshot halaman BscScan yang terverifikasi

### Jadwal yang disarankan

| Tanggal | Target |
| --- | --- |
| 25–26 Nov | Langkah 0–4: setup, tes lokal, testnet |
| 27 Nov | Langkah 5–6: deploy mainnet, web online |
| 28 Nov – 8 Des | Langkah 7: ajak pengguna, pasang bounty, posting di X |
| 8 Des | Langkah 8: kirim proyek (jangan tunggu hari terakhir) |

## Kewenangan owner (wajib diungkap menurut aturan)

**Tidak ada.** Kontrak tidak punya owner, admin, fee, fungsi pause, mint, freeze, upgrade, maupun penarikan
oleh admin. BNB di escrow hanya bisa keluar ke pemasang bounty (refund) atau pekerja yang ditunjuk (pembayaran).

## Catatan risiko

Ini perangkat lunak eksperimental dan belum diaudit. Gunakan nominal kecil. Hadiah bounty adalah bayaran
atas pekerjaan, bukan imbal hasil investasi.
