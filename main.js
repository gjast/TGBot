import { Bot } from "grammy";
import dotenv from "dotenv";
import fs from "fs/promises";
import fetchData from "./request.js";
dotenv.config();
const fileName = "./base.json";

class EditBase {
  constructor() {
    this.fileName = fileName;
    this.userIndex = false;
    this.currencies = {};
  }



  async readBase() {
    try {
      const data = await fs.readFile(this.fileName, "utf8");
      return JSON.parse(data);
    } catch (err) {
      console.error("Ошибка при чтении файла:", err);
      if (err.code === "ENOENT") {
        await this.deleteBase();
        return { users: [] };
      }
      throw err;
    }
  }

  async writeBase(userID, currencies) {
    try {
      const data = await this.readBase();
      console.log("CTROKA 35", currencies);
      data.promotion = Object.keys(currencies).reduce((acc, key) => {
        if (!acc[key]) {
          acc[key] = ""; 
        }
        return acc;
      }, data.promotion || {});

      if (this.userIndex !== -1) {
        data.users[this.userIndex].currencies = {
          ...data.users[this.userIndex].currencies,
          ...currencies,
        };
        console.log("CTROKA 42", currencies);
      } else {
        data.users.push({ userID: userID, currencies: currencies });
      }

      await fs.writeFile(this.fileName, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error("Ошибка при записи в базу:", error);
      throw error;
    }
  }

  async checkUser(userID) {
    try {
      const data = await this.readBase();
      this.userIndex = data.users.findIndex((user) => user.userID === userID);
      console.log(this.userIndex);
      if (this.userIndex !== -1) {
        console.log("Пользователь найден");
        return this.userIndex;
      } else {
        console.log("Пользователь не найден");
        return false;
      }
    } catch (error) {
      console.error("Ошибка при проверке пользователя:", error);
      throw error;
    }
  }

  async deleteBase(name) {
    try {
      const data = await this.readBase();
      if (name != "all") {
        delete data.users[this.userIndex].currencies[name];
        await fs.writeFile(this.fileName, JSON.stringify(data, null, 2));
      } else {
        delete data.users[this.userIndex].currencies;
        await fs.writeFile(this.fileName, JSON.stringify(data, null, 2));
      }
    } catch (error) {
      console.error(error);
    }
  }
}

class TGBot extends EditBase {
  constructor(apiKey) {
    super();
    if (!apiKey) throw new Error("API ключ не предоставлен");
    this.bot = new Bot(apiKey);
    this.waitingForCurrency = false;
    this.waitingForPriceCheck = false;
    this.userID = null;
    this.init();
    setInterval(() => this.sendMessage(), 360000);
  }

  async sendMessage() {
    const data = await this.readBase();
    const promotion = data.promotion;
    const users = data.users;

    for (const user of users) {
      for (const price in user.currencies) {
        console.log(user.currencies[price], promotion[price]);
        if (user.currencies[price] <= promotion[price] && promotion[price] != "") {
          await this.bot.api.sendMessage(user.userID, `Уведомление: Цена акции ${price} достигла ${promotion[price]}. Ваша целевая цена: ${user.currencies[price]}`);
          delete user.currencies[price];
          await fs.writeFile(this.fileName, JSON.stringify(data, null, 2));
        }
      }
    }
  }

  init() {
    this.bot.start();
    this.bot.command("start", async (ctx) => {
      try {
        this.userID = ctx.from.id;
        await this.checkUser(this.userID);

        await ctx.reply("Выберите действие:", {
          reply_markup: {
            keyboard: [
              [{ text: "/watch" }, { text: "/View course" }],
              [{ text: "/Output observables" }, { text: "/Remove watched" }],
            ],
            resize_keyboard: true,
            one_time_keyboard: true,
          },
        });
      } catch (error) {
        console.error("Ошибка в команде start:", error);
        await ctx.reply("Произошла ошибка при запуске бота");
      }
    });

    this.bot.on("message:text", async (ctx) => {
      try {
        const text = ctx.message.text;
        this.userID = ctx.from.id;

        if (!text.startsWith("/")) {
          if (this.waitingForCurrency) {
            await this.processCurrencyInput(ctx);
          } else if (this.waitingForPriceCheck) {
            await this.processPriceCheck(ctx);
          }
          return;
        }

        const commands = {
          "/watch": async () => {
            await this.checkUser(this.userID);
            await ctx.deleteMessage();
            await this.addCurrency(ctx);
          },
          "/View course": async () => {
            await ctx.deleteMessage();
            await this.checkPrice(ctx);
          },
          "/Output observables": async () => {
            await this.checkUser(this.userID);
            await ctx.deleteMessage();
            await this.checkOutput(ctx);
          },

          "/Remove watched": async () => {
            await this.checkUser(this.userID);
            await ctx.deleteMessage();
            await this.deleteCurrencies(ctx);
          },
        };

        const command = commands[text];
        if (command) {
          await command();
        } else {
          await ctx.reply("Неизвестная команда");
        }
      } catch (error) {
        console.error("Ошибка при обработке сообщения:", error);
        await ctx.reply("Произошла ошибка при обработке команды");
      }
    });

    this.bot.on("callback_query:data", async (ctx) => {
      const selectedCurrency = ctx.callbackQuery.data;
      await this.deleteBase(selectedCurrency);
      ctx.reply("Акция удалена");
    });
  }

  async addCurrency(ctx) {
    try {
      this.waitingForPriceCheck = false;
      this.waitingForCurrency = true;
      await ctx.reply(
        "Введите название акции и цену уведомления. Например: Яндекс/15000"
      );
    } catch (error) {
      console.error("Ошибка в addCurrency:", error);
      await ctx.reply("Произошла ошибка");
    }
  }

  async processCurrencyInput(ctx) {
    try {
      const [name, price] = ctx.message.text.split("/");
      const trimmedName = name.trim();
      const trimmedPrice = price?.trim();

      if (!trimmedName || !trimmedPrice || isNaN(Number(trimmedPrice))) {
        return await ctx.reply(
          "Неверный формат. Используйте формат: Название/Цена"
        );
      }

      const data = await fetchData(
        `https://api.bcs.ru/udfdatafeed/v1/search/group?search=${encodeURIComponent(
          trimmedName
        )}`
      );
      console.log(data);

      if (!data || !data.shortName) {
        return await ctx.reply("Акция не найдена");
      }

      this.currencies[data.shortName] = Number(trimmedPrice);

      await this.writeBase(this.userID, this.currencies);

      await ctx.reply(
        `Акция ${data.shortName} добавлена для отслеживания по цене ${trimmedPrice}`
      );
    } catch (error) {
      console.error("Ошибка при обработке ввода валюты:", error);
      await ctx.reply("Ошибка при обработке запроса");
    } finally {
      this.waitingForCurrency = false;
    }
  }

  async processPriceCheck(ctx) {
    try {
      const name = ctx.message.text.trim();
      if (!name) {
        return await ctx.reply("Введите название акции");
      }

      const data = await fetchData(
        `https://api.bcs.ru/udfdatafeed/v1/search/group?search=${encodeURIComponent(
          name
        )}`
      );

      if (!data || !data.shortName) {
        return await ctx.reply("Акция не найдена");
      }

      await ctx.reply(
        `Текущая цена ${data.shortName}: ${data.closePrice} \n ${data.profit}%`
      );
    } catch (error) {
      console.error("Ошибка при проверке цены:", error);
      await ctx.reply("Ошибка при получении цены");
    } finally {
      this.waitingForPriceCheck = false;
    }
  }

  async checkOutput(ctx) {
    try {
      const data = await this.readBase();
      console.log(this.userIndex);
      await ctx.reply(
        `Бот наблюдает за акциями:\n${Object.entries(
          data.users[this.userIndex].currencies
        )
          .map(([key, value]) => `${key} - ${value}`)
          .join("\n")}`
      );
    } catch (error) {
      await ctx.reply("Произошла некая ошибка, у вас нет акций");
    }
  }

  async checkPrice(ctx) {
    try {
      this.waitingForCurrency = false;
      this.waitingForPriceCheck = true;
      await ctx.reply("Введите название акции для проверки курса:");
    } catch (error) {
      console.error("Ошибка в checkPrice:", error);
      await ctx.reply("Произошла ошибка");
    }
  }

  async deleteCurrencies(ctx) {
    try {
      const data = await this.readBase();
      const currencies = data.users[this.userIndex].currencies;
      const keyboard = {
        inline_keyboard: [
          ...Object.keys(currencies).map((currency) => [
            {
              text: currency,
              callback_data: `${currency}`,
            },
          ]),
          [
            {
              text: "all",
              callback_data: "all",
            },
          ],
        ],
      };

      await ctx.reply("Выберите акцию для удаления:", {
        reply_markup: keyboard,
      });
    } catch (error) {
      console.error("Ошибка при удалении акций:", error);
      await ctx.reply("Ошибка при удалении акций, возможно у вас нет акций");
    }
  }



}



const bot = new TGBot(process.env.BOT_API_KEY);


