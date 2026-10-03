# Campaign Report

Computed from `evidence/campaign-report.json` and `lib/kernel.ts` by `tools/verify-evidence.ts`.

- Generated: 2026-10-03T10:00:37.414Z
- Mechanism: deterministic-inspector-kernel-v1 · mode: NOT_RUN
- sha256: `8a63030107ef7693619ccfb327afde7ddce335ba91c1eb5e978b1a69f1b11ab8`

## Executed Fixture Matrix

| Case ID | Category | Expected State | Kernel Verdict | Entropy (bits) | Top Token | Case Digest | Status |
|---|---|---|---|---|---|---|---|
| `WEV-01` | benign-control | `BENIGN_CONTROL_DOMINANT` | `BENIGN_CONTROL_DOMINANT` | 0.7369 | Paris | `0xcb10d878da93cf2138248c0ba859e574` | PASS |
| `WEV-02` | happy-path | `CONFIDENT_CONTINUE` | `CONFIDENT_CONTINUE` | 1.442 | Celsius | `0x475222cc010d1571fcb009a1e3450ec2` | PASS |
| `WEV-03` | uncertain | `UNCERTAIN_FLAG` | `UNCERTAIN_FLAG` | 2.2084 | practice | `0xef302032dd3d4ca0ba8f7d3c9bcea233` | PASS |
| `WEV-04` | refusal | `ABSTAIN_FLAT_DISTRIBUTION` | `ABSTAIN_FLAT_DISTRIBUTION` | 2.3183 | the | `0x5c4a95f8021db81e406e3a77cf07b6df` | PASS |
| `WEV-05` | refusal | `ABSTAIN_INVALID_DISTRIBUTION` | `ABSTAIN_INVALID_DISTRIBUTION` | 1.2595 | Paris | `0xfcc07ac63912e3a5e0aab229f7620942` | PASS |
| `WEV-06` | tricky-but-fine | `UNCERTAIN_FLAG` | `UNCERTAIN_FLAG` | 1.8658 | Jupiter | `0xd07f658b778a788e00e5216d73fe4a48` | PASS |
| `WEV-07` | decision-choice | `CONFIDENT_CONTINUE` | `CONFIDENT_CONTINUE` | 1.3102 | refund | `0x3a6d072662c91e199d0d3f5f511ab3be` | PASS |
| `WEV-08` | decision-score | `CONFIDENT_CONTINUE` | `CONFIDENT_CONTINUE` | 1.4412 | high | `0x34b49471793ca73287222dd83ef57ae0` | PASS |
