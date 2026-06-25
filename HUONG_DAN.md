# Hướng dẫn nộp CAPProbe — CROO Agent Hackathon

> **Trạng thái:** code + repo + CI (xanh, Node 18/20/22) + video demo (`docs/demo.mp4`) **đã xong và đã public**
> tại https://github.com/kenzo0910/capprobe. Còn lại 4 việc cần **tài khoản CROO + ví USDC của bạn**.
> Hạn nộp BUIDL: **9/7/2026**.

---

## 0. Chuẩn bị (1 lần)

- Có **USDC trên mạng Base** trong ví của bạn (~5 USDC là dư để test). Mua trên sàn rồi rút về Base, hoặc bridge sang Base.
- (Khuyến nghị) Revoke 2 token GitHub đã dán trong chat tại https://github.com/settings/tokens.

## 1. Đăng ký trên Agent Store — https://agent.croo.network

Đăng nhập (ví / Google / email) → hệ thống tự tạo **Navigator** (tài khoản chính). Tạo **3 agent**:

| Agent | Tên gợi ý        | Service       | Nạp USDC?                        |
| ----- | ---------------- | ------------- | -------------------------------- |
| **A** | `CAPProbe`       | có (xem dưới) | **CÓ** (để trả target khi probe) |
| **B** | `Demo Requester` | không         | **CÓ** (để trả CAPProbe)         |
| **C** | `Echo Target`    | có (xem dưới) | Không                            |

> Muốn nhanh/đỡ tốn: chỉ cần **Agent A + nạp USDC**, rồi probe 1 agent có sẵn (xem §3 "Cách nhanh").

**Tạo service** (trang Configure của agent → **“+ Add Service”**):

- **Agent A → service "CAPProbe Conformance Test"**: Price `0.50`, Deliverable **Text**, Requirements **Text**, SLA `0h 10m`, Require Fund Transfer **OFF**.
- **Agent C → service "Echo Target"** (`demo-echo`): Price `0.01`, Deliverable **Text**, Requirements **Text**, SLA `0h 5m`.

Sau khi tạo, **copy lại**: API Key (`croo_sk_…`) của **A, B, C** và **Service ID** của **A** và **C**.
⚠️ Service ID do store sinh ra — dùng **đúng ID đó** (tên `capprobe.conformance.v1` trong code chỉ là mặc định).

## 2. Nạp USDC (Base)

Gửi USDC (token USDC chuẩn trên **Base**) từ ví của bạn **tới địa chỉ AA wallet** của **Agent A** và **Agent B** (địa chỉ xem trong trang agent trên store). ~2–3 USDC mỗi ví.

## 3. Chạy live (đừng dán key vào chat — điền tại máy)

**Cách đầy đủ — 3-hop, 2 settlement (1 lệnh):**

```powershell
cd D:\JS\CAPProbe
$env:CROO_MODE='live'
$env:CAPPROBE_API_KEY='<KEY_A>'; $env:CAPPROBE_SERVICE_ID='<SVC_A>'
$env:TARGET_API_KEY='<KEY_C>';   $env:TARGET_SERVICE_ID='<SVC_C>'
$env:REQUESTER_API_KEY='<KEY_B>'
npm run demo:full
```

→ in JSON report; vào **BaseScan** xem **2 giao dịch USDC** (ví A và ví C).

**Cách nhanh — 1 agent, 1 settlement:**

```powershell
cd D:\JS\CAPProbe
$env:CROO_MODE='live'; $env:CROO_API_KEY='<KEY_A>'
npm run probe -- <serviceId-của-1-agent-có-sẵn-trên-store>
```

## 4. Video

`docs/demo.mp4` (60s) đã có sẵn phần **offline** (3-hop 100/A + ca lỗi 15/F + kiến trúc).
Quay thêm đoạn **live** ở §3 (màn hình chạy `demo:full` + 2 tx trên BaseScan) rồi ghép vào sau → đủ cut ≤5 phút.
Kịch bản chi tiết: `JUDGING.md §6`.

## 5. Nộp BUIDL — https://dorahacks.io/hackathon/croo-hackathon

File BUIDL, điền:

- **Name:** CAPProbe
- **Track:** Developer Tooling
- **Repo:** https://github.com/kenzo0910/capprobe
- **Video:** link YouTube/Loom (hoặc upload `docs/demo.mp4`)
- **Description:** copy từ [`SUBMISSION.md`](SUBMISSION.md)

---

## Checklist 5 yêu cầu hackathon

- [x] **Open source GitHub public (MIT)** — kenzo0910/capprobe
- [x] **Integrated with CAP** (negotiate→pay→deliver, settle USDC) — code + test 22/22 + CI xanh
- [ ] **Listed on CROO Agent Store** (Base mainnet) — §1
- [ ] **Demo video ≤5min** — offline xong; thêm đoạn live §4
- [ ] **BUIDL filed on DoraHacks** trước 9/7 — §5
