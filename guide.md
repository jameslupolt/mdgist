# Markdown Guide

This page is a practical reference for writing standard Markdown in mdgist.

## Headings

```md
# H1
## H2
### H3
#### H4
##### H5
###### H6
```

## Paragraphs and Line Breaks

Leave a blank line between paragraphs.

```md
This is the first paragraph.

This is the second paragraph.
```

For a forced line break, end a line with two spaces.

## Emphasis

```md
*italic* or _italic_
**bold** or __bold__
***bold + italic***
~~strikethrough~~
```

## Blockquotes

```md
> A single-level quote.
>
> Still part of the same quote.

>> A nested quote.
```

## Lists

Unordered:

```md
- Item one
- Item two
  - Nested item
```

Ordered:

```md
1. First
2. Second
3. Third
```

Task list:

```md
- [ ] Open task
- [x] Completed task
```

## Links

Inline link:

```md
[mdgist](https://example.com)
```

Reference link:

```md
[Docs][docs]

[docs]: https://example.com/docs
```

## Images

```md
![Alt text](https://example.com/image.png "Optional title")
```

## Inline Code and Code Blocks

Inline code:

```md
Use `const value = 1` in JavaScript.
```

Fenced code block:

<pre>
```js
function greet(name) {
  return `hello ${name}`;
}
```
</pre>

## Horizontal Rules

```md
---
```

## Tables

```md
| Name  | Role     | Active |
|-------|----------|--------|
| Alex  | Writer   | Yes    |
| Jamie | Reviewer | No     |
```

## Escaping Characters

Use a backslash to escape formatting characters.

```md
\*not italic\*
\# not a heading
```

## HTML in Markdown

Simple HTML generally works in Markdown documents.

```md
<details>
  <summary>Click to expand</summary>
  Hidden content.
</details>
```

## Optional Table of Contents Token

You can insert this token to place a generated table of contents:

```md
[[[TOC]]]
```
