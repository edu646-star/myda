// ==============================================================================
// Vercel Serverless Function: /api/analyze
// 설명: 사용자의 일기 내용을 받아 Google Gemini 3.6 Flash AI로 감정을 분석하고 결과를 반환합니다.
// 보안: API 키는 브라우저에 노출되지 않고 Vercel 환경변수(process.env.GEMINI_API_KEY)에서 로드됩니다.
// 호환성: CommonJS(module.exports) 방식으로 작성되어 Vercel Node.js 런타임에서 100% 동작합니다.
// ==============================================================================

module.exports = async function handler(req, res) {
    // 1. CORS 헤더 설정
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // OPTIONS 사전 요청 처리
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // 2. HTTP 메서드 검증 (POST 요청만 허용)
    if (req.method !== 'POST') {
        return res.status(405).json({
            error: '허용되지 않은 메서드입니다. POST 요청을 사용해주세요.'
        });
    }

    // 3. 환경변수에서 Gemini API 키 확인
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        return res.status(500).json({
            error: '서버에 GEMINI_API_KEY 환경변수가 설정되지 않았습니다. Vercel 프로젝트 Settings -> Environment Variables에서 GEMINI_API_KEY를 등록해주세요.'
        });
    }

    try {
        // 4. 요청 본문(Body)에서 일기 텍스트 추출 (문자열 또는 객체 처리)
        let body = req.body;
        if (typeof body === 'string') {
            try {
                body = JSON.parse(body);
            } catch (e) {
                // 파싱 실패 시 빈 객체 처리
            }
        }

        const content = body?.content ? String(body.content).trim() : '';
        if (!content) {
            return res.status(400).json({
                error: '분석할 일기 내용(content)이 비어있습니다.'
            });
        }

        // 5. Gemini AI 감정 분석 프롬프트
        const systemPrompt = `
당신은 사용자의 일기 글을 읽고 마음을 깊이 어루만져 주는 따뜻하고 다정한 전문 심리 상담 AI입니다.
사용자가 작성한 아래 일기 내용을 읽고, 감정을 섬세하게 분석하여 반드시 유효한 JSON 형식으로만 응답해주세요.

반드시 다음 JSON 키를 가진 객체로만 응답하세요:
{
  "emoji": "해당 감정을 가장 잘 나타내는 이모지 1개 (예: 🌸, 😢, 💖, 🌿, ☕, 🌟, 🥱, 🌧️ 등)",
  "tag": "감정의 핵심을 표현하는 따뜻한 요약 태그 (예: '보람찬 하루', '마음껏 속상해해도 되는 날' 등)",
  "message": "사용자의 일기 속 구체적인 내용에 공감하며 용기와 위로를 건네는 2~3줄의 다정한 메시지",
  "bgColor": "감정에 어울리는 연한 파스텔 배경 색상코드 (예: 기쁨 #FEF9C3, 슬픔 #EFF6FF, 분노 #FFF1F2, 피로 #F5F3FF, 평온 #F0FDF4 등)",
  "borderColor": "배경과 조화를 이루는 연한 테두리 색상코드 (예: #FDE047, #BFDBFE, #FECDD3, #DDD6FE, #BBF7D0 등)"
}

일기 내용:
"${content}"
`;

        // 6. Google Gemini API 호출 (최신 gemini-3.6-flash 모델)
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`;

        const geminiResponse = await fetch(geminiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                contents: [
                    {
                        parts: [{ text: systemPrompt }]
                    }
                ],
                generationConfig: {
                    responseMimeType: 'application/json',
                    temperature: 0.7,
                    maxOutputTokens: 2048
                }
            })
        });

        if (!geminiResponse.ok) {
            const errorText = await geminiResponse.text();
            console.error('❌ Gemini API 응답 오류:', errorText);
            return res.status(geminiResponse.status).json({
                error: 'Gemini AI 서비스 호출 중 오류가 발생했습니다: ' + errorText
            });
        }

        const data = await geminiResponse.json();

        // 7. 응답에서 텍스트 추출 및 JSON 파싱
        let rawText = '';
        const parts = data?.candidates?.[0]?.content?.parts || [];
        for (const part of parts) {
            if (part.text) {
                rawText += part.text;
            }
        }
        
        let cleanedJsonText = rawText.trim();
        if (cleanedJsonText.startsWith('```json')) {
            cleanedJsonText = cleanedJsonText.slice(7);
        } else if (cleanedJsonText.startsWith('```')) {
            cleanedJsonText = cleanedJsonText.slice(3);
        }
        if (cleanedJsonText.endsWith('```')) {
            cleanedJsonText = cleanedJsonText.slice(0, -3);
        }
        cleanedJsonText = cleanedJsonText.trim();

        let parsedResult;
        try {
            parsedResult = JSON.parse(cleanedJsonText);
        } catch (parseError) {
            // 정규식 기반 안전 파싱
            const emojiMatch = cleanedJsonText.match(/"emoji"\s*:\s*"([^"]+)"/);
            const tagMatch = cleanedJsonText.match(/"tag"\s*:\s*"([^"]+)"/);
            const messageMatch = cleanedJsonText.match(/"message"\s*:\s*"([^"]+)"/);

            parsedResult = {
                emoji: emojiMatch ? emojiMatch[1] : '🌿',
                tag: tagMatch ? tagMatch[1] : '마음의 소리',
                message: messageMatch ? messageMatch[1] : (rawText || '오늘 하루도 소중한 마음을 기록해주셔서 감사합니다.'),
                bgColor: '#F0FDF4',
                borderColor: '#BBF7D0'
            };
        }

        // 필수 기본값 안전 보정
        if (!parsedResult.emoji) parsedResult.emoji = '🌿';
        if (!parsedResult.tag) parsedResult.tag = '소중한 하루';
        if (!parsedResult.message) parsedResult.message = '오늘 하루도 소중한 마음을 기록해주셔서 감사합니다.';
        if (!parsedResult.bgColor) parsedResult.bgColor = '#F8FAFC';
        if (!parsedResult.borderColor) parsedResult.borderColor = '#E2E8F0';

        // 8. 클라이언트에 성공 결과 반환
        return res.status(200).json(parsedResult);

    } catch (error) {
        console.error('❌ 서버 내부 오류 발생:', error);
        return res.status(500).json({
            error: '서버 내부 처리 중 문제가 발생했습니다: ' + error.message
        });
    }
};
