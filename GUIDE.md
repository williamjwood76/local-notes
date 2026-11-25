# Using Notes

Notes are plain markdown files in a folder you choose. The app does not upload them. Open the command palette with ⌘P and type **Help** to read this again.

## Open a folder

Choose **Open…** and pick the folder of notes. The app remembers that folder and the tabs you had open. One folder is open at a time. **Toggle open daily note on launch** makes the app open today’s daily note when that folder loads. It is off until you turn it on.

## Files

The left column is the folder. Drag its right edge to make filenames readable.

- **New note** and **New folder** create files next to the selected item.
- **Rename** changes the name. Links that pointed at that note are updated. A unique name stays short. A name used by two notes keeps the folder in the link. Renaming a heading updates `[[Note#Heading]]` links that pointed at the old heading.
- Drag a file onto a folder to move it there. Drop it on the empty part of the file list to move it to the top of the folder.
- **Trash** asks first, then moves the file into a hidden trash folder. **Restore** at the bottom of the file list puts it back. It is not removed from the disk until you delete that hidden folder yourself.
- **Star** (command **Toggle star**) pins a note at the top of the file list. **Recent** lists the notes you opened last.

Click a markdown file to edit it. Click a PDF to open it.

## Writing

The note saves itself shortly after you stop typing. ⌘S saves immediately.

The cursor line stays as markdown. The other lines show headings, emphasis, links, lists, quotes, code, tables, and callouts. **Toggle live preview** switches that off.

The bar above the note inserts markdown. It does not change the file into a different format. Select text first for bold, italic, underline, or a link.

- Click a note link to open it in the app. Click a web link to open it in your default browser. Click an image, or a link to an image file, to open it in the default app. Option-click a link or image to put the cursor there without opening it. Clicking anywhere that is not a link still edits that line.
- Type `[[` and pick a note with the arrow keys and Enter. Aliases are included.
- A link to a note that does not exist creates that note when you click it.
- `[[Note#Heading]]` opens that heading. `[[Note#^block]]` opens a block marked with `^block`.
- `![[Note]]` embeds another note. `![[image.png]]` embeds an image.
- Paste a screenshot into the note. It is saved in `attachments/` and embedded.
- Drop a file onto the note. Images are embedded. Other files, including PDFs, are linked and saved in `attachments/`.
- `$x^2$` is inline math. `$$` on its own lines is a larger equation.
- A code block that starts with ` ```mermaid ` draws a diagram.
- A callout starts with `> [!note]` followed by the text on the next lines.
- `- [ ]` is an open task. Click the box in the note, or use **Show open tasks**. In that list, **Today** keeps tasks from today’s daily note, and the tag box keeps tasks on notes with that tag, or tasks whose line contains it.
- Spellcheck follows the Mac dictionary. **Toggle spellcheck** turns it off.

## Find

- **Find in note** (⌘F) jumps through matches in the open note. It ignores capitalization.
- **Search** in the left column searches every note. `tag:name` limits it to a tag. `file:` and `path:` limit the name.
- **Find and replace** changes a literal phrase in every note and tells you how many places will change before you run it.
- **Quick open** (⌘O) finds a note by its title, filename, or alias.

## The right column

- **Outline** is the headings. Click one to jump there.
- **Backlinks** are notes that link here.
- **Unlinked mentions** are other notes that contain this note’s title but do not link to it. **Link** wraps that mention in `[[ ]]`. Titles shorter than three characters are ignored, and text inside code is ignored.
- **Outgoing** are the links in this note. A missing one can be clicked to create the note.

## Properties, tags, and aliases

A block of YAML between `---` lines at the top of a note is its properties. Edit them in the panel above the note. The rest of the file is left as you wrote it.

`#tag` in the text, or a `tags` property, shows in the Tags list.

To give a note another name, add a property called `aliases` with a list, or `alias` with one name. `[[that name]]` opens the note. Quick open finds it too.

## Daily notes and templates

**Open daily note** (⌘D), or the **Today** button, creates today’s note, named with the date, or opens it if it is already there. **Yesterday** does the same for the day before. The strip under the top bar is the three days on either side of today. **Set daily notes folder** chooses where these notes go.

**Insert today’s date**, or the **Date** button, adds today’s date (`YYYY-MM-DD`) at the bottom of the note you already have open. It does not create a new note.

**Set template note** points at a markdown file. **Insert template** pastes it at the cursor. `{{date}}`, `{{time}}`, and `{{title}}` are filled in. A new daily note uses that template the first time it is created.

## Layout

- **Split right** and **Split down** divide the window.
- Drag the divider to resize a split.
- **Close tab** (⌘W) and **Close pane** put the layout back.
- The open tabs and splits are restored the next time you open the same folder.
- ⌘B hides the file list. Shift-⌘B hides the right column.

## Graph

**Open graph** draws notes as dots and wikilinks as lines. Click a dot to open the note. **Show neighboring notes** keeps the notes linked to the one you are reading. **Show full graph** shows the folder. **Toggle orphan notes** hides notes with no links. The tag box on the graph filters to one tag.

## PDFs

Open a PDF from the file list. Select text, choose a color, and click **Highlight**. The marks are stored in a sidecar file next to the PDF and are not shown in the file list. **Delete** removes the selected mark.

## Commands

⌘P opens the command list. The commands cover preview, sidebars, splits, daily notes, templates, stars, tasks, find and replace, the graph, and this guide.
