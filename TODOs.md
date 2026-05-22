## Improvements To Writing Notes

The note writing on highlighted bits could really use some refinement and polish. It works functionally correctly today, but I want to make this more refined.

### In "Native" View (Non-Reader Mode)

- Where it pops up is fine
- I don't like having to manually drag the length to be extended myself
- It I'm writing a note that goes beyond the available no. of rows, it should expand naturally to show my full note (until a reasonable amount... say 15 rows). Obviously be cautious about implementing this (for example, we may have limited page height left, so don't go beyond that, unless the user scrolls up and now you have more speace)


### In "Reader" View

There are multiple possible improvements to be made here.
I will dump my thoughts below in a semi structured way. These are not individual tasks to be done. Rather, I want you to help me synthesise my thoughts into more coherent ones to understand what's common across them and what a holistic solution looks like.

1. The note input box itself: This is functional, but looks ugly. Reader view is one where we have control. We can set themes for it. The note input should look native to the theme.
2. We view notes that have been taken on the right margin, but the note input appears where the highlighted bit ends. This feels jarring, and like we can unify where we write the notes vs. where they end up to make the whole experience feel more cohesive
3. When the note that's been taken is taller than the highlighted section, and say we do this for two consecutive paragarphs, then the notes just get stacked one below the other. It's hard to say which note corresponds to which part that's been annotated
4. Adjacent to highlighter as well: I find the highlighter to be way too loud. I'm on the "Solarized" theme in the reader, and want it to be MUCH more subtle. It shouldn't get in the way of reading. I think the highlighter color is currently the same across all themes
5. Similar to the above two points, when I've written a note for a section, I want to clearly be able to tell which section I've written a note for, and this should work well with dense as well as sparse notes
