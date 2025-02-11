import fs from "fs/promises";

async function fetchData(url) {
  try {
    const response = await fetch(url);
    const data = await response.json();

    return data.data[0].instruments[0];
  } catch (error) {
    console.error("Ошибка при получении данных:", error);
    throw error;
  }
}

async function getPromotion() {
  try {
    // Чтение файла один раз в начале
    let fileContent = await fs.readFile("./base.json", "utf8");
    let data = JSON.parse(fileContent);
    let parsedData = data.promotion;

    let keys = Object.keys(parsedData);
    let hasUpdates = false;

    for (const key of keys) {
      try {
        // Пропускаем пустые ключи
        if (!key) continue;

        const response = await fetch(
          `https://api.bcs.ru/udfdatafeed/v1/search/group?search=${encodeURIComponent(
            key
          )}&limit=3`,
          {
            headers: {
              'Accept': 'application/json'
            }
          }
        );

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const responseData = await response.json();

        // Проверяем наличие данных
        if (responseData.data && 
            responseData.data[0] && 
            responseData.data[0].instruments && 
            responseData.data[0].instruments[0]) {
          
          const promotionData = responseData.data[0].instruments[0];
          if (promotionData.closePrice) {
            data.promotion[key] = promotionData.closePrice;
            hasUpdates = true;
          }
        }

      } catch (error) {
        console.error(`Error fetching data for ${key}:`, error);
      }
    }

    // Записываем в файл только если были обновления
    if (hasUpdates) {
      await fs.writeFile("./base.json", JSON.stringify(data, null, 2));
    }

  } catch (error) {
    console.error("Error reading or parsing base.json:", error);
  }
}
setInterval(() => getPromotion(), 300000); 

export default fetchData;
