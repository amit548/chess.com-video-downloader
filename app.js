import "dotenv/config";
import { launch } from "puppeteer";
import { createWriteStream } from "fs";
import { get as httpsGet } from "https";
import { get as httpGet } from "http";
import path from "path";
import { lstat, mkdir } from "fs/promises";

const checkIfDirExists = async (filePath) => {
  try {
    const stats = await lstat(filePath);
    return stats.isDirectory();
  } catch (error) {
    return false;
  }
};

const checkIfFileExists = async (filePath) => {
  try {
    const stats = await lstat(filePath);
    return stats.isFile();
  } catch (error) {
    return false;
  }
};

const createDir = async (filePath) => {
  try {
    if (!(await checkIfDirExists(filePath))) await mkdir(filePath);
  } catch (error) {
    console.error(error);
  }
};

const relaceSpecialCharsFromCourseTitle = (courseTitle) => {
  return courseTitle
    .replace(/[/\\?%*:|"<>]/g, " -")
    .replace(/[\u0000-\u0019]/g, "");
};

const downloader = (url, fileName) =>
  new Promise((resolve, reject) => {
    const file = createWriteStream(fileName);
    const get = url.startsWith("https") ? httpsGet : httpGet;
    get(url, (res) => {
      res.pipe(file);
      file.on("finish", () => {
        file.close();
        resolve(true);
      });

      file.on("error", (_) => {
        file.close();
        reject(false);
      });
    });
  });

(async () => {
  try {
    const browser = await launch({
      headless: false,
      timeout: 0,
    });
    const page = await browser.newPage();
    await page.goto("https://www.chess.com/login");
    await page.type("#username", String(process.env.CHESS_COM_USERNAME));
    await page.type("#password", String(process.env.CHESS_COM_PASSWORD));
    await page.click("#_remember_me");
    await page.click("#login");
    await page.goto("https://www.chess.com/lessons/all-lessons", {
      timeout: 0,
      waitUntil: "load",
    });
    let isPageEnd = false;
    while (!isPageEnd) {
      await page.waitForSelector(".course-wrapper", {
        timeout: 0,
        waitUntil: "load",
      });
      const courses = await page.$$eval(".course-component", (courses) => {
        return courses.map((course) => {
          return {
            title: course.querySelector(".course-title").innerText,
            url: course.querySelector("a").href,
          };
        });
      });
      for (const course of courses) {
        const coursePage = await browser.newPage();

        await Promise.all([
          coursePage.waitForNavigation({ timeout: 0, waitUntil: "load" }),
          coursePage.goto(course.url, { timeout: 0, waitUntil: "load" }),
        ]);

        await coursePage.waitForSelector(".lesson-component", {
          timeout: 0,
          waitUntil: "load",
        });

        const lessons = await coursePage.$$eval(
          ".lesson-component",
          (_lessons) => {
            return _lessons.map((lesson) => {
              return {
                title: lesson.querySelector(".lesson-title").innerText,
                url: lesson.querySelector("a").href,
              };
            });
          }
        );

        await coursePage.close();

        for (const [index, lesson] of lessons.entries()) {
          const lessonPage = await browser.newPage();

          await Promise.all([
            lessonPage.waitForNavigation({ timeout: 0, waitUntil: "load" }),
            lessonPage.goto(lesson.url, { timeout: 0, waitUntil: "load" }),
          ]);

          const hasVideo = await lessonPage.$("video");
          if (!hasVideo) {
            console.log("No video: ", lesson.title);
            await lessonPage.close();
            continue;
          }

          const video = await lessonPage.$eval("video", (video) => {
            return video.src;
          });

          course.title = relaceSpecialCharsFromCourseTitle(course.title);
          lesson.title = relaceSpecialCharsFromCourseTitle(lesson.title);

          await createDir(path.join(process.cwd(), "downloads", course.title));

          const fileIndex = index + 1 < 10 ? `0${index + 1}` : index + 1;
          const fileName = path.join(
            process.cwd(),
            "downloads",
            course.title,
            `${fileIndex} - ${lesson.title}.mp4`
          );
          if (await checkIfFileExists(fileName)) {
            console.log("Already downloaded: ", lesson.title);
            await lessonPage.close();
            continue;
          }
          console.log("Downloading: ", lesson.title);
          await downloader(video, fileName);
          console.log("Downloaded: ", lesson.title);

          await lessonPage.close();
        }
      }

      const isDisabled = await page.$eval(
        ".ui_pagination-item-icon.icon-font-chess.chevron-right",
        (button) => {
          return button.parentElement.getAttribute("disabled");
        }
      );

      isPageEnd = Boolean(isDisabled);

      if (isPageEnd) {
        await browser.close();
      } else {
        await Promise.all([
          page.$eval(
            ".ui_pagination-item-icon.icon-font-chess.chevron-right",
            (button) => button.parentElement.click()
          ),
          page.waitForNavigation({ timeout: 0, waitUntil: "load" }),
        ]);
      }
    }
  } catch (error) {
    console.error(error);
  }
})();
