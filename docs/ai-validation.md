# Hyked AI validation — September 24, 2026

## Scope and results

The browser model (Llama 3.2 3B) has four uses: prioritizing known trip insights, extracting additional specifications from readable product text, generating constrained alternative product searches, and selecting which public product links the app should open for specs. Trail matching, geocoding, shopping gaps, pack arithmetic and packing zones use deterministic application logic; they do not require model inference.

| Check | Environment | Result |
| --- | --- | --- |
| “30 miles, 3 days in Colorado” | Live planner | Parsed correctly; Four Pass Loop offered with its source and historical-data caveat. |
| “10 miles, 2 days near Banff” | Live planner | Required an exact place choice; Banff, Alberta returned 829 trail sections inside a 50 km radius. |
| Gear and shopping gaps | Live planner | Existing browser gear included; missing sleep gear, navigation and other essentials listed for the trip. No test gear or trip saved. |
| Supply totals | Live planner | 24 oz/day × 3 days = 4.5 lb food, 2 liters = approximately 4.4 lb water, 8 oz = 0.5 lb fuel; 9.4 lb subtotal. Missing tent weight remained explicitly incomplete. |
| Name-to-page gear lookup | Live gear editor | NEMO Tensor All-Season found its manufacturer; Regular Mummy kept its own 17 oz packed weight, 199.95 USD price and 10 × 4 inch packed size. |
| Production product reading after the fix | Live gear editor, actual NEMO page | Cached model loaded, read the selected size, found no additional supported facts and retained the existing 17 oz weight and 199.95 USD price. |
| Nonexistent product search | Live gear editor | A deliberately nonexistent test name completed the enabled AI fallback and returned “No matching product found,” without replacing the previous sourced form values. |
| Unsafe product URL | Live gear editor | Non-public HTTP link rejected; no fields populated. |
| Production startup and trip inference after the fix | Live planner | Model completed its download and produced an explanation identifying the unselected route, incomplete pack total and actual missing tent weight. |
| Model load cancellation | Live planner | Download cancelled and controls returned to Off; planning remained available. |
| Trip insight inference | Actual browser model, isolated fixture | Prioritized pace mismatch, incomplete total and missing tent weight using supplied facts only. |
| Search query inference | Actual browser model, isolated fixture | Produced “REI Half Dome 2 Plus specifications” and “Half Dome 2 Plus REI specs”; identity and size retained. |
| Narrative specification extraction | Actual browser model, synthetic fixture | Extracted 4.4 pounds (70.4 oz) and polyester with exact source quotes. Did not recover the fixture's price or packed size; coverage is not universal. |
| No-specification narrative | Actual browser model, synthetic fixture | Returned no supported additions; no invented values. |
| Cancel during extraction | Actual browser model, isolated fixture | Stopped promptly; no late answer applied. |

## Issue found and fixed

WebLLM reports worker errors as strings. The app previously discarded the cause and displayed a generic startup failure. Errors now retain their bounded message.

Live initialization repeatedly failed with `Cache.add()` network errors while downloading model-weight shards. Isolated diagnostics identified a failing public Hugging Face shard. Recovery requests a fresh, uncached download, waits for its complete body, and writes it under the original cache key. This successfully initialized the model in Chrome. Production recovery is scoped to this model's official asset path, allows only two additional attempts, rejects partial responses, honors cancellation and preserves storage-quota errors. Existing completed downloads remain cached.

Regression tests cover worker-string errors, malformed errors, complete-body caching, interrupted response streams, HTTP partial responses, bounded retries, unrelated URLs, cache hits, storage quota failure and cancellation. The full suite has 112 passing tests. Scoped ESLint and the production webpack build passed before release. Cached model startup was also re-tested successfully using the final worker implementation.

## Limits

Physical phones and browsers without WebGPU were not exercised. This validation does not claim every retailer is accessible or every specification can be recovered. Existing account-storage configuration still prevents cloud gear sync; browser-local gear remains usable. No account schema or permissions were changed as part of these AI tests. The temporary fixture page is excluded from the shipped app.
