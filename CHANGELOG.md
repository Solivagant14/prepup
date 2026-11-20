# Changelog

What has shipped, newest first. PrepUp has no version numbers yet: the hosted copy runs `main`.

If you run your own copy, entries marked **migration** need `pnpm db:migrate` after you pull them ([how](docs/self-hosting.md#2-create-the-tables)).

## November 2026

- **New address: prepup.site.** The hosted copy moved from prepup-amber.vercel.app. A connector added with the old address stops working; remove it and add `https://prepup.site/mcp`. Self-hosters: [Use your own domain](docs/self-hosting.md#use-your-own-domain).
- **Open-source housekeeping.** A shorter README, layered docs, a contributing guide, issue and pull request templates. The Dockerfile is gone: Vercel is the supported way to host.
- **A full sign-in screen** ([#18](https://github.com/Solivagant14/prepup/pull/18)). Sign in, create account and reset password with email, alongside Google and GitHub, with plain-language errors.
- **A guide for any assistant** ([#17](https://github.com/Solivagant14/prepup/pull/17)). Eight guide pages with their own navigation, readable without sign-in. The app is now Deck · Guide · Settings, and says "your assistant" in place of one app's name.
- **Usable by anyone** ([#13](https://github.com/Solivagant14/prepup/pull/13) to [#16](https://github.com/Solivagant14/prepup/pull/16)). An app frame with a tab bar on phones, the card pop-up as a sheet, a first-visit start, toasts, and a calmer deck.
- **Public launch** ([#12](https://github.com/Solivagant14/prepup/pull/12)). A public costs page and an optional support link.
- **Graph view** ([#11](https://github.com/Solivagant14/prepup/pull/11)). The deck as a board of topics and links you can pan and zoom.
- **Topics build on topics** ([#10](https://github.com/Solivagant14/prepup/pull/10)). "Builds on" links, proposed by your assistant and confirmed by you; prerequisites come first in *Prep now* and in tests. **Migration.**
- **Your own testing style** ([#9](https://github.com/Solivagant14/prepup/pull/9)). Write how you want to be tested; fixed rules always come first. MIT license and a self-hosting guide. **Migration.**
- **Safe to share** ([#8](https://github.com/Solivagant14/prepup/pull/8)). Per-user request limits, a topic cap, stricter token checks, nightly encrypted backups, and erase-my-data. **Migration.**
- **Sign in with Google or GitHub** ([#6](https://github.com/Solivagant14/prepup/pull/6)).
- **Your assistant drafts your explanation** ([#5](https://github.com/Solivagant14/prepup/pull/5)). After a test, saved only if you approve it.
- **The web app** ([#2](https://github.com/Solivagant14/prepup/pull/2)). The card deck, served with the API from one Vercel project.
- **The core** ([#1](https://github.com/Solivagant14/prepup/pull/1)). Scoring and fade rules, the database, REST, and the MCP server behind Supabase sign-in.
