# Third-party skill sources

Some skills in this directory adapt material from other repositories. Each adapted skill names its
source in its first paragraph. Notices required by the source licenses follow.

## forge-gpu (Zlib)

Source: https://github.com/Nebulavenus/forge-gpu — `.claude/skills/dev-physics-lesson`,
`.claude/skills/dev-physics-review`, `.claude/skills/pbr-shading`.
Used in: `pollyroll-physics`, `pollyroll-webgl`. These are altered versions, not the original.

```
Copyright (c) 2025 Rosy Game Studio

This software is provided 'as-is', without any express or implied warranty. In no event will the
authors be held liable for any damages arising from the use of this software.

Permission is granted to anyone to use this software for any purpose, including commercial
applications, and to alter it and redistribute it freely, subject to the following restrictions:

1. The origin of this software must not be misrepresented; you must not claim that you wrote the
   original software. If you use this software in a product, an acknowledgment in the product
   documentation would be appreciated but is not required.
2. Altered source versions must be plainly marked as such, and must not be misrepresented as being
   the original software.
3. This notice may not be removed or altered from any source distribution.
```

## Guidance paraphrased, not copied

`pollyroll-concise-code` also restates ideas from Anthropic's prompting best practices
("minimize overengineering") and forrestchang/andrej-karpathy-skills `karpathy-guidelines` in its
own words. No text from either is reproduced.

`pollyroll-typescript` paraphrases checks from Anthropic `claude-plugins-official`
`pr-review-toolkit` agents `type-design-analyzer` and `silent-failure-hunter` (Apache-2.0).
`pollyroll-testing` paraphrases Trail of Bits `property-based-testing` (CC-BY-SA-4.0). No text from
either is reproduced.

## MIT-licensed sources

- nuqs `.agents/skills/bundle-size-bake-off` — https://github.com/47ng/nuqs — Copyright (c) 2020
  François Best. Used in `pollyroll-size-bakeoff`.
- mattpocock/skills `skills/engineering/tdd` — https://github.com/mattpocock/skills — Copyright (c)
  2026 Matt Pocock. Used in `pollyroll-development` (test anti-patterns).
- Cursor plugins `cursor-team-kit/skills/deslop` — https://github.com/cursor/plugins — Copyright (c)
  2026 Cursor. Focus areas and guardrails used in `pollyroll-concise-code`.
- Cursor plugins `pstack/skills/typescript-best-practices` and
  `pstack/skills/principle-test-behavior-not-implementation` — https://github.com/cursor/plugins —
  Copyright (c) 2026 Lauren Tan. Used in `pollyroll-typescript` and `pollyroll-testing`.
- mattpocock/skills `skills/engineering/code-review` and `codebase-design` — Copyright (c) 2026
  Matt Pocock. Smell list and deletion test used in `pollyroll-typescript`.
- obra/superpowers `skills/test-driven-development/writing-good-tests.md` —
  https://github.com/obra/superpowers — Copyright (c) 2025 Jesse Vincent. Used in
  `pollyroll-testing`.
- nyxandro/property-testing-skill — https://github.com/nyxandro/property-testing-skill — Copyright
  (c) 2026 nyxandro. fast-check rules used in `pollyroll-testing`.
- testdino playwright-skill `core/canvas-and-webgl.md` — https://github.com/testdino-hq/playwright-skill
  — Copyright (c) 2026 TestDino. Used in `pollyroll-visual-tests`.

```
Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
associated documentation files (the "Software"), to deal in the Software without restriction,
including without limitation the rights to use, copy, modify, merge, publish, distribute,
sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or
substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES
OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```
