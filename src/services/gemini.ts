export interface CorrectionItem {
  itemIndex: number;
  spellingCorrect: boolean;
  spellingExpected: string;
  spellingActual: string;
  posCorrect: boolean;
  posExpected: string;
  posActual: string;
  meaningCorrect: boolean;
  meaningExpected: string;
  meaningActual: string;
  isCorrect: boolean;
  boundingBox?: {
    box_2d: [number, number, number, number]; // [ymin, xmin, ymax, xmax] normalized 0-1000
    label: string;
  }[];
}

export function getStoredApiKey(): string {
  // 1. Check localStorage (for deployed static web environments like GitHub Pages)
  if (typeof window !== 'undefined') {
    const localKey = window.localStorage.getItem('custom_gemini_api_key');
    if (localKey && localKey.trim()) return localKey.trim();
  }
  
  // 2. Check Vite env variables (embedded at build time if provided)
  const viteKey = (import.meta as any).env?.VITE_GEMINI_API_KEY;
  if (viteKey && viteKey.trim()) return viteKey.trim();

  return '';
}

export async function ocrHandwrittenAnswer(base64Image: string, mimeType: string): Promise<string> {
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    const apiKey = getStoredApiKey();
    if (apiKey) {
      headers["X-Custom-API-Key"] = apiKey;
    }

    const response = await fetch("/api/ocr-answer", {
      method: "POST",
      headers,
      body: JSON.stringify({ base64Image, mimeType }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `HTTP error ${response.status}`);
    }

    const data = await response.json();
    return data.text;
  } catch (error: any) {
    console.error("Client OCR Error:", error);
    throw new Error(`标准答案识别失败: ${error.message || "未知错误"}`);
  }
}

export async function correctAssignment(
  assignmentBase64: string,
  mimeType: string,
  answerText: string
): Promise<CorrectionItem[]> {
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    const apiKey = getStoredApiKey();
    if (apiKey) {
      headers["X-Custom-API-Key"] = apiKey;
    }

    const response = await fetch("/api/correct-assignment", {
      method: "POST",
      headers,
      body: JSON.stringify({ assignmentBase64, mimeType, answerText }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `HTTP error ${response.status}`);
    }

    return await response.json();
  } catch (error: any) {
    console.error("Client Correction Error:", error);
    throw new Error(`作业批改失败: ${error.message || "未知错误"}`);
  }
}
