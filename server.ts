import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";

const PORT = 3000;

function getAIInstance(customApiKey?: string) {
  const apiKey = customApiKey || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "未检测到配置好的 Gemini API 密钥。\n" +
      "1. 如果在 AI Studio 预览环境，请确保在 Settings -> Secrets 中配置了 GEMINI_API_KEY 密钥。\n" +
      "2. 如果在部署后的独立网页 (如 GitHub Pages)，请点击页面右上角「API密钥配置」按钮，输入并保存您的 API 密钥（将本地安全缓存于浏览器，绝对不向任何服务器透露，安全放心）。"
    );
  }
  return new GoogleGenAI({ 
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build'
      }
    }
  });
}

async function startServer() {
  const app = express();

  // Enable body parser with higher limit for base64 images
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // API 1: OCR standard handwritten answer
  app.post("/api/ocr-answer", async (req, res) => {
    try {
      const { base64Image, mimeType } = req.body;
      const customApiKey = req.headers["x-custom-api-key"] as string | undefined;

      if (!base64Image) {
        return res.status(400).json({ error: "缺少 base64Image 参数" });
      }

      const ai = getAIInstance(customApiKey);
      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: [
          {
            parts: [
              { text: "请准确识别此图片中的手写听写标准答案，内容通常包含：英文单词、词性（如n., v., adj.等）、中文解释。如果你识别到多个单词，请按每行一个的格式整理输出，例如：\n1. beautiful adj. 美丽的\n2. dictionary n. 字典" },
              { inlineData: { data: base64Image.split(',')[1] || base64Image, mimeType: mimeType || "image/jpeg" } }
            ]
          }
        ]
      });

      if (!response.text) {
        throw new Error("未能成功从 API 获取到标准答案文本");
      }

      res.json({ text: response.text });
    } catch (err: any) {
      console.error("Server OCR Error:", err);
      res.status(500).json({ error: err.message || "未知错误" });
    }
  });

  // API 2: Correct dictation assignment
  app.post("/api/correct-assignment", async (req, res) => {
    try {
      const { assignmentBase64, mimeType, answerText } = req.body;
      const customApiKey = req.headers["x-custom-api-key"] as string | undefined;

      if (!assignmentBase64 || !answerText) {
        return res.status(400).json({ error: "缺少 assignmentBase64 或 answerText 参数" });
      }

      const ai = getAIInstance(customApiKey);
      const prompt = `
        你是一位专业的语言老师。现在需要对一张手写听写作业（图片）进行自动批改。
        标准答案（包含英文拼写、词性、中文意思三项）为: 
        """
        ${answerText}
        """
        
        任务要求：
        1. 识别学生在作业图片中书写的所有听写项。
        2. 针对每一个听写项，分别从以下共三项内容进行核对批改：
           - 英文拼写 (Spelling): 要求严格，全词拼写必须正确。
           - 词性 (Part of Speech): 词性缩写（如 n., v., adj., adv. 等）是否准确。
           - 中文意思 (Meaning): 极大放宽！实行非常宽容的“意对即可”和“部分字词匹配”规则：
             - 准许学生只写标准答案中的部分汉字，甚至仅写出其中任意一个字即算正确（例如：标准答案“字典”，学生写“典”或“字”即对；标准“美丽的”，学生写“美”即对；标准“拼写”，学生写“拼”即对）。
             - 任何意义相近、同义词、近义词表达均视为完全正确并得分（例如：标准答案是“纠正”，学生写“改”、“改正”、“对的”、“纠”等均应算对）。
             - 只要学生手写的中文意思与标准答案存在任何语义交叉、包含关系、核心字重合或意思相近，一律判定为正确 (meaningCorrect: true)。
        3. 判定该听写项的整体是否完全正确 (isCorrect)。仅当英文拼写、词性、中文意思这三项按各自评判标准全部为正确时，此项才为 true。
        4. 如果某项有任何错误，请提供它在图像中对应的边界框 [ymin, xmin, ymax, xmax]，坐标值归一化在 0 - 1000 之间。
        
        返回的结果必须是一个符合以下 JSON Schema 格式 of JSON 数组。
      `;

      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: [
          {
            parts: [
              { text: prompt },
              { inlineData: { data: assignmentBase64.split(',')[1] || assignmentBase64, mimeType: mimeType || "image/jpeg" } }
            ]
          }
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            description: "List of corrected dictation items found in the assignment",
            items: {
              type: Type.OBJECT,
              properties: {
                itemIndex: { type: Type.INTEGER, description: "听写条目序号，从1开始" },
                spellingCorrect: { type: Type.BOOLEAN, description: "英文拼写是否正确" },
                spellingExpected: { type: Type.STRING, description: "标准英文拼写" },
                spellingActual: { type: Type.STRING, description: "学生实际写的拼写" },
                
                posCorrect: { type: Type.BOOLEAN, description: "词性是否正确" },
                posExpected: { type: Type.STRING, description: "标准词性" },
                posActual: { type: Type.STRING, description: "学生实际写的词性" },
                
                meaningCorrect: { type: Type.BOOLEAN, description: "中文意思是否正确" },
                meaningExpected: { type: Type.STRING, description: "标准中文意思" },
                meaningActual: { type: Type.STRING, description: "学生实际写的中文意思" },
                
                isCorrect: { type: Type.BOOLEAN, description: "此项是否完美全对（三项皆对才为true）" },
                boundingBox: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      box_2d: {
                        type: Type.ARRAY,
                        items: { type: Type.INTEGER },
                        description: "归一化的坐标框 [ymin, xmin, ymax, xmax]"
                      },
                      label: { type: Type.STRING, description: "错误标签，如 spelling_error, pos_error, meaning_error" }
                    }
                  }
                }
              },
              required: [
                "itemIndex", 
                "spellingCorrect", "spellingExpected", "spellingActual",
                "posCorrect", "posExpected", "posActual",
                "meaningCorrect", "meaningExpected", "meaningActual",
                "isCorrect"
              ]
            }
          }
        }
      });

      if (!response.text) {
        throw new Error("未能成功从 API 获取到批改结果 JSON");
      }

      res.json(JSON.parse(response.text));
    } catch (err: any) {
      console.error("Server Correction Error:", err);
      res.status(500).json({ error: err.message || "未知错误" });
    }
  });

  // Serve static assets in production, setup Vite server dev middleware in development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
