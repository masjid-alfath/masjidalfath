require("dotenv").config();

const { Client } = require("@notionhq/client");
const fs = require("fs/promises");
const path = require("path");
const sharp = require("sharp");

const notion = new Client({
  auth: process.env.NOTION_TOKEN,
});

const notionAgenda = new Client({
  auth: process.env.NOTION_AGENDA_TOKEN,
});

const notionProgram = new Client({
  auth: process.env.NOTION_PROGRAM_TOKEN,
});

const DATA_SOURCE_ID =
  process.env.NOTION_ARTIKEL_DATA_SOURCE_ID;

const AGENDA_DATA_SOURCE_ID =
  process.env.NOTION_AGENDA_DATA_SOURCE_ID;

const PROGRAM_DATA_SOURCE_ID =
  process.env.NOTION_PROGRAM_DATA_SOURCE_ID;

const PROGRAM_OUTPUT =
  path.join(
    process.cwd(),
    "data",
    "program.yaml"
  );

const AGENDA_OUTPUT =
  path.join(
    process.cwd(),
    "data",
    "agenda.yaml"
  );

const OUTPUT_DIR = path.join(
  process.cwd(),
  "content",
  "artikel"
);

const IMAGE_DIR = path.join(
  process.cwd(),
  "static",
  "images",
  "artikel"
);


/* =========================================================
   HELPERS
   ========================================================= */

function plainText(items = []) {
  return items.map(item => item.plain_text || "").join("");
}


function escapeYaml(value = "") {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, " ");
}


function slugify(value = "") {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .trim()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}


function richTextToMarkdown(items = []) {
  return items.map(item => {

    let text = item.plain_text || "";

    if (!text) return "";

    // Escape characters that commonly interfere with Markdown.
    text = text.replace(/([\\`])/g, "\\$1");

    const annotations = item.annotations || {};

    if (annotations.code) {
      text = `\`${text}\``;
    } else {
      if (annotations.bold) {
        text = `**${text}**`;
      }

      if (annotations.italic) {
        text = `*${text}*`;
      }

      if (annotations.strikethrough) {
        text = `~~${text}~~`;
      }
    }

    if (item.href) {
      text = `[${text}](${item.href})`;
    }

    return text;

  }).join("");
}


async function getAllChildren(blockId) {

  const results = [];
  let cursor;

  do {

    const response =
      await notion.blocks.children.list({
        block_id: blockId,
        start_cursor: cursor,
        page_size: 100,
      });

    results.push(...response.results);

    cursor = response.has_more
      ? response.next_cursor
      : undefined;

  } while (cursor);

  return results;
}


/* =========================================================
   THUMBNAIL PIPELINE
   ========================================================= */

async function processThumbnail(url, slug) {

  if (!url) return "";

  console.log("  ↓ Download thumbnail");

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Thumbnail download gagal: ${response.status}`
    );
  }

  const buffer = Buffer.from(
    await response.arrayBuffer()
  );

  const sizes = [640, 960, 1280];

  for (const width of sizes) {

    const filename =
      `${slug}-${width}.webp`;

    const destination =
      path.join(
        IMAGE_DIR,
        filename
      );

    await sharp(buffer)
      .rotate()
      .resize({
        width,
        withoutEnlargement: true,
      })
      .webp({
        quality: 78,
        effort: 5,
      })
      .toFile(destination);

    console.log(
      `    ✓ ${filename}`
    );
  }

  return `/images/artikel/${slug}-960.webp`;
}


/* =========================================================
   BLOCK → MARKDOWN
   ========================================================= */

async function blockToMarkdown(block) {

  const type = block.type;
  const data = block[type];

  if (!data) return "";


  switch (type) {

    case "paragraph":
      return richTextToMarkdown(data.rich_text);


    case "heading_1":
      return `# ${richTextToMarkdown(data.rich_text)}`;


    case "heading_2":
      return `## ${richTextToMarkdown(data.rich_text)}`;


    case "heading_3":
      return `### ${richTextToMarkdown(data.rich_text)}`;


    case "bulleted_list_item":
      return `- ${richTextToMarkdown(data.rich_text)}`;


    case "numbered_list_item":
      return `1. ${richTextToMarkdown(data.rich_text)}`;


    case "quote": {
      const text =
        richTextToMarkdown(data.rich_text);

      return text
        .split("\n")
        .map(line => `> ${line}`)
        .join("\n");
    }


    case "divider":
      return "---";


    case "code": {

      const language =
        data.language &&
        data.language !== "plain text"
          ? data.language
          : "";

      const code =
        plainText(data.rich_text);

      return `\`\`\`${language}\n${code}\n\`\`\``;
    }


    case "image": {

      const url =
        data.type === "external"
          ? data.external?.url
          : data.file?.url;

      if (!url) return "";

      const caption =
        plainText(data.caption) || "";

      return `![${caption}](${url})`;
    }


    case "bookmark":

      if (!data.url) return "";

      return `[${data.url}](${data.url})`;


    case "link_preview":

      if (!data.url) return "";

      return `[${data.url}](${data.url})`;


    default:

      console.log(
        `  ↳ block "${type}" belum didukung`
      );

      return "";
  }
}


async function pageBodyToMarkdown(pageId) {

  const blocks =
    await getAllChildren(pageId);

  const output = [];

  for (const block of blocks) {

    let markdown =
      await blockToMarkdown(block);

    if (markdown) {
      output.push(markdown);
    }

    /*
     * Child blocks tetap kita baca.
     * Ini penting untuk toggle/callout/nested content
     * ketika nanti converter diperluas.
     */
    if (block.has_children) {

      const children =
        await pageBodyToMarkdown(block.id);

      if (children.trim()) {
        output.push(children);
      }
    }
  }

  return output.join("\n\n");
}


/* =========================================================
   QUERY NOTION
   ========================================================= */

async function getPublishedArticles() {

  const articles = [];

  let cursor;

  do {

    const response =
      await notion.dataSources.query({
        data_source_id: DATA_SOURCE_ID,

        filter: {
          property: "Tampilkan di Website",
          checkbox: {
            equals: true,
          },
        },

        sorts: [
          {
            property: "Tanggal",
            direction: "descending",
          },
        ],

        start_cursor: cursor,
        page_size: 100,
      });

    articles.push(...response.results);

    cursor = response.has_more
      ? response.next_cursor
      : undefined;

  } while (cursor);

  return articles;
}


/* =========================================================
   PAGE → HUGO
   ========================================================= */

async function pageToHugo(page) {

  const props = page.properties;


  const title =
    plainText(props.Judul?.title);


  const customSlug =
    plainText(props.Slug?.rich_text);


  const slug =
    slugify(customSlug || title);


  const date =
    props.Tanggal?.date?.start ||
    page.created_time;


  const category =
    props.Kategori?.select?.name || "";


  const author =
    plainText(props.Penulis?.rich_text) ||
    "Masjid Al-Fath";


  const excerpt =
    plainText(props.Ringkasan?.rich_text);


  const thumbnailFile =
    props.Thumbnail?.files?.[0];


  const remoteThumbnail =
    thumbnailFile?.type === "external"
      ? thumbnailFile.external?.url
      : thumbnailFile?.file?.url || "";


  if (!title) {
    console.log(
      `⚠ Skip ${page.id}: Judul kosong`
    );
    return;
  }


  if (!slug) {
    console.log(
      `⚠ Skip "${title}": slug tidak dapat dibuat`
    );
    return;
  }


  console.log(`→ ${title}`);

  let thumbnail = "";

  if (remoteThumbnail) {

    try {

      thumbnail =
        await processThumbnail(
          remoteThumbnail,
          slug
        );

    } catch (error) {

      console.warn(
        `  ⚠ Thumbnail gagal diproses: ${error.message}`
      );

    }
  }


  const body =
    await pageBodyToMarkdown(page.id);


  const frontMatter = `---
title: "${escapeYaml(title)}"
date: "${escapeYaml(date)}"
author: "${escapeYaml(author)}"
categories:
  - "${escapeYaml(category)}"
excerpt: "${escapeYaml(excerpt)}"
thumbnail: "${escapeYaml(thumbnail)}"
notion_id: "${page.id}"
generated_by_notion: true
draft: false
---

`;


  const filePath =
    path.join(
      OUTPUT_DIR,
      `${slug}.md`
    );


  await fs.writeFile(
    filePath,
    frontMatter + body.trim() + "\n",
    "utf8"
  );


  console.log(
    `  ✓ content/artikel/${slug}.md`
  );
}


/* =========================================================
   NOTION → HUGO : AGENDA
   ========================================================= */

function yamlString(value = "") {
  return `"${String(value)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, " ")}"`;
}


function formatAgendaDate(isoDate) {

  const date =
    new Date(isoDate);

  const day =
    new Intl.DateTimeFormat(
      "id-ID",
      {
        timeZone: "Asia/Jakarta",
        day: "2-digit",
      }
    ).format(date);

  const month =
    new Intl.DateTimeFormat(
      "id-ID",
      {
        timeZone: "Asia/Jakarta",
        month: "short",
      }
    )
      .format(date)
      .replace(".", "")
      .toUpperCase();

  const weekday =
    new Intl.DateTimeFormat(
      "id-ID",
      {
        timeZone: "Asia/Jakarta",
        weekday: "long",
      }
    ).format(date);

  const time =
    new Intl.DateTimeFormat(
      "id-ID",
      {
        timeZone: "Asia/Jakarta",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }
    )
      .format(date)
      .replace(":", ".");

  return {
    day,
    month,
    weekday,
    time,
  };
}


async function getPublishedAgenda() {

  const results = [];

  let cursor;

  do {

    const response =
      await notionAgenda.dataSources.query({

        data_source_id:
          AGENDA_DATA_SOURCE_ID,

        filter: {
          property:
            "Tampilkan di Website",

          checkbox: {
            equals: true,
          },
        },

        sorts: [
          {
            property: "Tanggal",
            direction: "ascending",
          },
        ],

        start_cursor: cursor,

        page_size: 100,
      });


    results.push(
      ...response.results
    );


    cursor =
      response.has_more
        ? response.next_cursor
        : undefined;

  } while (cursor);


  return results;
}


function agendaPageToObject(page) {

  const props =
    page.properties;


  const name =
    plainText(
      props["Nama Agenda"]?.title
    );


  const date =
    props.Tanggal?.date?.start;


  const theme =
    plainText(
      props.Tema?.rich_text
    );


  const speaker =
    plainText(
      props.Pemateri?.rich_text
    );


  const program =
    props.Program?.select?.name || "";


  const location =
    plainText(
      props.Lokasi?.rich_text
    );


  const status =
    props.Status?.select?.name ||
    "Terjadwal";


  if (!name || !date) {
    return null;
  }


  const formatted =
    formatAgendaDate(date);


  return {
    notionId: page.id,
    name,
    date,
    theme,
    speaker,
    program,
    location,
    status,
    ...formatted,
  };
}


function agendaToYaml(items) {

  if (!items.length) {
    return "[]\n";
  }


  return items.map(item => {

    return [
      `- name: ${yamlString(item.name)}`,
      `  date: ${yamlString(item.date)}`,
      `  day: ${yamlString(item.day)}`,
      `  month: ${yamlString(item.month)}`,
      `  weekday: ${yamlString(item.weekday)}`,
      `  time: ${yamlString(item.time)}`,
      `  theme: ${yamlString(item.theme)}`,
      `  speaker: ${yamlString(item.speaker)}`,
      `  program: ${yamlString(item.program)}`,
      `  location: ${yamlString(item.location)}`,
      `  status: ${yamlString(item.status)}`,
      `  notion_id: ${yamlString(item.notionId)}`,
    ].join("\n");

  }).join("\n\n") + "\n";
}


async function syncAgenda() {

  if (!process.env.NOTION_AGENDA_TOKEN) {
    throw new Error(
      "NOTION_AGENDA_TOKEN belum tersedia."
    );
  }


  if (!AGENDA_DATA_SOURCE_ID) {
    throw new Error(
      "NOTION_AGENDA_DATA_SOURCE_ID belum tersedia."
    );
  }


  console.log(
    "\n=== NOTION → HUGO : AGENDA ===\n"
  );


  const pages =
    await getPublishedAgenda();


  /*
   * Kita gunakan waktu Jakarta agar hasil build
   * konsisten antara Mac lokal dan Cloudflare.
   */
  const nowJakarta =
    new Date(
      new Date().toLocaleString(
        "en-US",
        {
          timeZone:
            "Asia/Jakarta",
        }
      )
    );


  const agenda =
    pages
      .map(agendaPageToObject)
      .filter(Boolean)

      /*
       * Jangan tampilkan agenda yang tanggalnya
       * sudah lewat.
       *
       * Kita beri toleransi sampai akhir hari
       * supaya agenda hari ini tidak hilang
       * setelah jam acaranya lewat.
       */
      .filter(item => {

        const event =
          new Date(item.date);

        const eventJakarta =
          new Date(
            event.toLocaleString(
              "en-US",
              {
                timeZone:
                  "Asia/Jakarta",
              }
            )
          );

        eventJakarta.setHours(
          23,
          59,
          59,
          999
        );


        return (
          eventJakarta >=
          nowJakarta
        );
      })

      .sort(
        (a, b) =>
          new Date(a.date) -
          new Date(b.date)
      );


  await fs.mkdir(
    path.dirname(AGENDA_OUTPUT),
    {
      recursive: true,
    }
  );


  await fs.writeFile(
    AGENDA_OUTPUT,
    agendaToYaml(agenda),
    "utf8"
  );


  console.log(
    `Ditemukan ${agenda.length} agenda aktif.`
  );


  for (const item of agenda) {

    console.log(
      `→ ${item.day} ${item.month} · ${item.name} · ${item.status}`
    );

  }


  console.log(
    "\n✓ data/agenda.yaml diperbarui."
  );
}


/* =========================================================
   NOTION → HUGO : PROGRAM
   ========================================================= */

async function getPublishedPrograms() {

  const results = [];
  let cursor;

  do {

    const response =
      await notionProgram.dataSources.query({

        data_source_id:
          PROGRAM_DATA_SOURCE_ID,

        filter: {
          and: [
            {
              property:
                "Tampilkan di Website",

              checkbox: {
                equals: true,
              },
            },
            {
              property:
                "Status",

              select: {
                equals: "Aktif",
              },
            },
          ],
        },

        sorts: [
          {
            property: "Urutan",
            direction: "ascending",
          },
        ],

        start_cursor: cursor,

        page_size: 100,
      });


    results.push(
      ...response.results
    );


    cursor =
      response.has_more
        ? response.next_cursor
        : undefined;

  } while (cursor);


  return results;
}


function programPageToObject(page) {

  const props =
    page.properties;


  const name =
    plainText(
      props["Nama Program"]?.title
    );


  const category =
    props.Kategori?.select?.name || "";


  const summary =
    plainText(
      props.Ringkasan?.rich_text
    );


  const slug =
    plainText(
      props.Slug?.rich_text
    );


  const order =
    props.Urutan?.number ?? 999;


  if (!name || !category) {
    return null;
  }


  return {
    name,
    category,
    summary,
    slug,
    order,
  };
}


function buildProgramCategories(programs) {

  const definitions = [

    {
      category:
        "Kajian & Pendidikan",

      title:
        "Belajar dan bertumbuh bersama ilmu.",

      accent:
        "cyan",
    },

    {
      category:
        "Layanan Jamaah",

      title:
        "Hadir untuk kebutuhan jamaah.",

      accent:
        "violet",
    },

    {
      category:
        "Sosial & Sedekah",

      title:
        "Menebarkan manfaat lebih luas.",

      accent:
        "coral",
    },

  ];


  return definitions
    .map(definition => {

      const items =
        programs
          .filter(
            program =>
              program.category ===
              definition.category
          )
          .sort(
            (a, b) =>
              a.order - b.order
          );


      if (!items.length) {
        return null;
      }


      /*
       * Homepage tetap berupa kategori.
       * Deskripsi dibuat otomatis dari nama
       * program aktif pada kategori tersebut.
       */

      const names =
        items.map(
          item => item.name
        );


      let description = "";

      if (names.length === 1) {

        description =
          names[0] + ".";

      } else if (names.length === 2) {

        description =
          `${names[0]} dan ${names[1]}.`;

      } else {

        description =
          names.slice(0, -1).join(", ") +
          `, dan ${names[names.length - 1]}.`;

      }


      return {
        title:
          definition.title,

        category:
          definition.category,

        description,

        accent:
          definition.accent,

        url:
          "/program/",
      };

    })
    .filter(Boolean);
}


function programCategoriesToYaml(items) {

  if (!items.length) {
    return "[]\n";
  }


  return items
    .map(item => [

      `- title: ${yamlString(item.title)}`,

      `  category: ${yamlString(item.category)}`,

      `  description: ${yamlString(item.description)}`,

      `  accent: ${yamlString(item.accent)}`,

      `  url: ${yamlString(item.url)}`,

    ].join("\n"))
    .join("\n\n") + "\n";
}


async function syncProgram() {

  if (!process.env.NOTION_PROGRAM_TOKEN) {
    throw new Error(
      "NOTION_PROGRAM_TOKEN belum tersedia."
    );
  }


  if (!PROGRAM_DATA_SOURCE_ID) {
    throw new Error(
      "NOTION_PROGRAM_DATA_SOURCE_ID belum tersedia."
    );
  }


  console.log(
    "\n=== NOTION → HUGO : PROGRAM ===\n"
  );


  const pages =
    await getPublishedPrograms();


  const programs =
    pages
      .map(programPageToObject)
      .filter(Boolean);


  console.log(
    `Ditemukan ${programs.length} program aktif.`
  );


  for (const program of programs) {

    console.log(
      `→ ${program.name} · ${program.category}`
    );

  }


  const categories =
    buildProgramCategories(
      programs
    );


  await fs.mkdir(
    path.dirname(PROGRAM_OUTPUT),
    {
      recursive: true,
    }
  );


  await fs.writeFile(
    PROGRAM_OUTPUT,
    programCategoriesToYaml(
      categories
    ),
    "utf8"
  );


  console.log(
    `\n✓ ${categories.length} kategori Program dibuat.`
  );

  console.log(
    "✓ data/program.yaml diperbarui."
  );
}


/* =========================================================
   MAIN
   ========================================================= */

async function main() {

  if (!process.env.NOTION_TOKEN) {
    throw new Error(
      "NOTION_TOKEN belum tersedia."
    );
  }


  if (!DATA_SOURCE_ID) {
    throw new Error(
      "NOTION_ARTIKEL_DATA_SOURCE_ID belum tersedia."
    );
  }


  await fs.mkdir(
    OUTPUT_DIR,
    { recursive: true }
  );

  await fs.mkdir(
    IMAGE_DIR,
    { recursive: true }
  );


  console.log(
    "\n=== NOTION → HUGO : ARTIKEL ===\n"
  );


  const pages =
    await getPublishedArticles();


  console.log(
    `Ditemukan ${pages.length} artikel published.\n`
  );


  for (const page of pages) {
    await pageToHugo(page);
  }


  console.log(
    "\n✓ Sync artikel selesai.\n"
  );


  await syncAgenda();

  await syncProgram();
}


main().catch(error => {

  console.error(
    "\n✗ Sync Notion gagal\n"
  );

  console.error(
    error.body ||
    error.message ||
    error
  );

  process.exit(1);
});
