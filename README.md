# Science Bowl Practice (React + Vite + TypeScript)

Science Bowl trainer: bot/practice/room play, per-subject 0-10 ratings with subject-specific placement tests, weakness profile, AI explanations, PDF/text packet scanning for all subjects, and a password screen.

```bash
npm install
npm run set-password -- "your long passphrase"   # optional site password
npm run dev      # local
npm run build    # dist/
```

- **AI:** Groq (`openai/gpt-oss-120b`; change `GROQ_MODEL` in `worker/wrangler.toml`, or `MODEL` in `src/platform.ts` for direct mode). Recommended: deploy `worker/` (Cloudflare Worker) so the key stays on the server, then set the repo variable `AI_PROXY_URL` (see worker/wrangler.toml). Without a proxy, each user pastes their own key on the Home screen. Never bake a key into the build.
- **Moderator tools** (code word in `src/App.tsx`): enable subjects, scan packets in the background, download `bank.json` and commit it to `public/bank.json` so everyone gets the questions.
- **Password screen** (`src/Gate.tsx`): a client-side check. It keeps casual visitors out but cannot protect anything a determined person can read from the site's code.
- **Deploy:** `.github/workflows/deploy.yml` publishes to GitHub Pages on every push to `main`.

- **Team games:** `worker/room.ts` is a Durable Object (one per room code) that runs seats, captains, clocks, buzz order, scoring and chat. Redeploy the Worker with `npx wrangler deploy` after pulling changes.
- **Question rules (team games):** in the lobby, at the break, or while paused, a captain can propose where questions come from (AI / uploaded packets / both, subjects, source, year/set, round, difficulty range). The other captain accepts, declines, or proposes the same thing. The host's browser picks the questions; if no uploaded question fits, an AI-written one (🤖) is used.
- **Accounts and friends:** `worker/accounts.ts` is a second Durable Object (SQLite storage, nothing extra to create). It stores usernames with PBKDF2-hashed passwords, 30-day sessions, each player's saved ratings/stats, friend requests and room invites. Sign-in needs the Worker (`AI_PROXY_URL`). There is no password recovery. Team games don't verify that a room name belongs to an account.
- **Updating the Worker:** `cd worker && npx wrangler deploy`. The first deploy after this change runs migration `v2` (adds the accounts store). No new secrets are needed.
- **Scanning many packets:** in Moderator tools, pick any number of files or a whole folder and scanning starts immediately in the background (files are opened one at a time, so hundreds are fine). The AI request count adapts to rate limits (set the maximum with "Speed"). Packets already scanned are skipped on the next pick; ones that had problems are retried. Keep the tab open until it finishes, then download `bank.json`.

## Energy subject
Energy is a sixth subject (like Biology, Chemistry and Earth & Space it is visible to moderators; turn it on under Moderator tools > Subjects). It has its own 0-10 rating, placement test, bot rating, filters and statistics. Packet scans put energy-resources questions (fossil fuels, nuclear, solar, wind, batteries, the grid…) there, and the AI can write Energy questions. The old ⚡ energy flag is gone: every question with a difficulty rating counts toward ratings. Re-scan packets to move older Energy-labelled questions out of Math/Physics.

## Exponents and subscripts
PDFs lose superscripts, so a variable written `x2`, `w2` or `y2` is shown as an exponent (x², w², y²) in every subject except Chemistry. Only a lone lowercase letter followed by a digit 2-9 is changed, so formulas such as H2O or CO2 are not touched. In Chemistry the digit could be a subscript, an ion charge or an exponent, so Moderator tools > Rate question difficulty > **Fix chemistry notation** asks the AI to decide and rewrite it in LaTeX (a rewrite is discarded if it changes anything but the formatting). Fixed text is saved in this browser and included in **Download everything**. Each question keeps its original id, so ratings stay attached.

## Question files
Every readable `.json` question file in `public/` (any subfolder) is loaded automatically. A file may be an array of questions, `{"qs":[...]}` or `{"questions":[...]}`. Unreadable files are listed under Moderator tools and in the Question database. Each question can carry flags: `energy`, `gs` (General Science, reclassified into a normal subject), accepted answers (`ax`, `bx`) and do-not-accept answers (`nx`, `bnx`).

Math, chemistry and physics are written in LaTeX inside `$...$` and drawn with KaTeX (including `\ce{...}` chemistry).

## Miscellaneous questions
General Science questions, and any question that fits none of the subjects (it spans several or tests general scientific knowledge), are **Miscellaneous**. They have no difficulty rating, never appear in practice, bot games, placement tests, rooms or ratings, and can only be seen in the **Question database** (Subject filter > Miscellaneous). In `bank.json` they keep their original subject in `sub` and carry `"misc": true` (and `"gs": true` if the packet called them General Science), with no `d`/`dr`. New packet scans flag them automatically; for questions already in the bank, run **Rate question difficulty** (the AI flags Miscellaneous ones instead of rating them).

## Difficulty ratings
Concept level counts as well as difficulty of execution. In skill-based subjects (math, physics, chemistry/energy calculation) regionals questions top out around difficult single-variable calculus, so a question needing a concept beyond that (multivariable calculus, linear algebra, hyperspheres, Lagrangian mechanics...) is rated above 5 even if simple: easier ones just above 5 (about 5.2-6), harder ones higher. In knowledge-based subjects (biology, earth and space) an advanced concept means an obscure fact, rated by how little-known it is. The wording lives in `RUBRIC` in `src/engine.ts`. Ratings already saved in a browser are not silently changed when the rubric is updated. To apply the current scale to those questions, use **Delete all saved ratings** and then run **Rate the unrated**; this recalculates them with the current rubric.

Moderator tools > Rate question difficulty asks the AI to rate every question on the current 0-10 scale (20 per request, saved as it goes, pauses 1 minute on a Groq rate limit). Ratings are stored locally by question id; use Download everything to publish them in a `public/*.json` file.

## Bots
A bot never buzzes before the earliest realistic point of a question (after the last number or formula, or after the choices for "which of the following"). The AI marks that point for each question (gray marker); without it a text rule is used. Stronger bots buzz closer to that point; knowledge decides whether they can answer at all.

## Moderator mode, database browsing and practice setup
- **Moderator mode:** entering the code word under Moderator tools turns moderator mode on for the tab session (Home shows a button to exit it). Everyone else only sees Math and Physics: Biology, Chemistry and Earth & Space questions, ratings and filters are hidden. Moderators choose which subjects they use under Moderator tools.
- **Edit database titles:** Moderator tools > "Edit how the question database looks" changes the source, year, set and round shown for a packet, or renames a source on every packet. Edits work at once in this browser; **Download everything** includes them (`meta`) so a published `public/*.json` shows them to everyone.
- **Question database:** "Browse questions" lists individual questions, 5 per page, sorted by difficulty (easiest or hardest first, or packet order) with subject, difficulty, source, year/set and round labels. Filter by source, year, round, subject, type and a difficulty range. The answer and bonus stay folded until opened.
- **Practice setup:** Home > "Practice setup" practices (or plays the bot on) exactly the questions you filter to, in random or packet order.

## End match, statistics, difficulty precision
- **End match:** practice and bot games have an "End match" button. It stops the game and shows a summary (score, correct, negs and each subject's rating change). The match is already saved in History.
- **Statistics:** Home > Statistics shows graphs of the questions you have gathered: questions by subject, the difficulty distribution (overall and split by subject), and mean difficulty by subject. A source picker limits every graph to one source, and a table compares sources. Your own game stats stay under History.
- **Difficulty** is stored and shown to the nearest thousandth (e.g. 3.250). Re-rating asks the AI for three decimals.

## Design
The look follows the Game Hub's "craft tabletop" style: warm paper with a dot grid, tactile buttons, Newsreader serif for headings, JetBrains Mono for small labels, and **Literata** for question text (a serif made for reading on screens, set larger with open line spacing).

- **Light and dark mode:** the sun/moon button in the header flips between them; Settings > Appearance offers Auto (follows the device), Light and Dark.
- **Themes:** Parchment, Slate pine and Kyoto washi each have a light and a dark version. Settings > Appearance > Theme opens the picker, where **Add theme** lets you choose paper, ink and accent colors for light and for dark mode (everything else is worked out from them, with a contrast warning). Added themes are saved in this browser and can be edited or deleted.
- **Settings** is a button in the header (practice, bot, appearance, AI connection). Built-in palettes live in `src/design.css`; added themes are handled in `src/platform.ts` and the picker in `src/settings.tsx`.
- **Moderator tools** use two even columns of matched cards (subjects/publish, scan/rate, public files/clear, titles/notes) under a row of totals.
