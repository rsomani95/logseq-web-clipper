# Adapting Obsidian Web Clipper To LogSeq

## How Pages Get Captured For LogSeq

- Raw page content goes under a "Page Content" block
- Highlights go under a "Highlights" block, instead of actually highlighting the page content
- Page Heading levels are stripped of markdown heading prefixes '#...' by default, as indents are the more LogSeq native way of representing hierarchy

## Other
- Remove redundant settings -- "Properties" and "Templates"
- Add a new "LogSeq Capture" settings block
