# Fonts

The console ships two fonts: Inter 4.1 (the variable woff2 from rsms/inter) and JetBrains Mono 2.304
(the static woff2 from JetBrains/JetBrainsMono in the three weights that machine values use). Both
are under the SIL Open Font License 1.1 (`OFL-Inter.txt` and `OFL-JetBrainsMono.txt`). The font
files travel with the repository so a build needs no network for them (`app/layout.tsx`,
`next/font/local`). The console sets no text in italics and preloads every listed file on every
page, so the italic files are left out.
