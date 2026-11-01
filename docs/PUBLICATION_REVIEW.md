# Public release review

Date: 2026-11-01. Reviewed source revision: `2d58da55418247827a73eec29555bea6e07d2557`.

## Scope and findings

- Inspected all 39 commits reachable from the local Git refs, including branch and tag history; scanned 20,800 unique Git blobs totaling 359,478,755 bytes.
- The local scanner checked recognizable Google, GitHub, AWS and OpenAI/Slack token formats, private-key headers, credential-bearing HTTP URLs, and quoted key/password/token assignments. It emitted file locations rather than matched secret values. No matches were found.
- A separate history filename check found historical `.env.example` files; no committed `.env.local`, private-key or credential files were found by that check.
- Checked common personal Windows/home-directory path patterns; no matches were found. Generic installation and training instructions are retained.
- Reviewed the README, architecture decisions, acceptance record, dataset provenance and training instructions. These describe development, assumptions and reported tests. Existing benchmark figures were not independently rerun as part of this publication review.
- Local `.claude/` files are untracked and excluded from this publication commit. Local raw data, generated training data and environment files remain outside the committed tree.

This is a bounded pattern-based review, not a security certification. It does not establish the absence of every possible secret or private detail. It does not OCR every image/video frame, inspect unreachable Git objects, or decode arbitrary binary containers. Runtime dependency vulnerabilities and service-side configuration are outside this review.

## Publication choices

- Original code and documentation text: MIT, with explicit exclusions for third-party data, imagery, weights and dependencies.
- Source and licensing boundaries: [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md). The ONNX weight license has not been independently cleared; it is excluded from the code license.
- Preserve existing commit authorship and commit IDs. Earlier commits identify the coding assistant as `Codex <codex@local>`.
- Configure future commits in this repository as Bokai He using the verified account's GitHub noreply address. No global Git identity change or history rewrite is required.
- Keep the live demonstration and publish the source repository. The deployment remains a static site with no application API keys.
