import _ from "lodash";

import APIException from "@/lib/exceptions/APIException.ts";
import EX from "@/api/consts/exceptions.ts";
import util from "@/lib/util.ts";
import { getCredit, receiveCredit, request } from "./core.ts";
import logger from "@/lib/logger.ts";

const DEFAULT_ASSISTANT_ID = "513695";
export const DEFAULT_MODEL = "jimeng-3.0";
const DRAFT_VERSION = "3.0.2";
const MODEL_MAP = {
  "jimeng-3.0": "high_aes_general_v30l:general_v3.0_18b",
  "jimeng-2.1": "high_aes_general_v21_L:general_v2.1_L",
  "jimeng-2.0-pro": "high_aes_general_v20_L:general_v2.0_L",
  "jimeng-2.0": "high_aes_general_v20:general_v2.0",
  "jimeng-1.4": "high_aes_general_v14:general_v1.4",
  "jimeng-xl-pro": "text2img_xl_sft",
};

export function getModel(model: string) {
  return MODEL_MAP[model] || MODEL_MAP[DEFAULT_MODEL];
}

export async function generateImages(
  _model: string,
  prompt: string,
  {
    width = 1024,
    height = 1024,
    sampleStrength = 0.5,
    negativePrompt = "",
  }: {
    width?: number;
    height?: number;
    sampleStrength?: number;
    negativePrompt?: string;
  },
  refreshToken: string
) {
  const model = getModel(_model);
  logger.info(`使用模型: ${_model} 映射模型: ${model} ${width}x${height} 精细度: ${sampleStrength}`);

  const { totalCredit } = await getCredit(refreshToken);
  if (totalCredit <= 0)
    await receiveCredit(refreshToken);

  const componentId = util.uuid();
  const { aigc_data } = await request(
    "post",
    "/mweb/v1/aigc_draft/generate",
    refreshToken,
    {
      params: {
        babi_param: encodeURIComponent(
          JSON.stringify({
            scenario: "image_video_generation",
            feature_key: "aigc_to_image",
            feature_entrance: "to_image",
            feature_entrance_detail: "to_image-" + model,
          })
        ),
      },
      data: {
        extend: {
          root_model: model,
          template_id: "",
        },
        submit_id: util.uuid(),
        metrics_extra: JSON.stringify({
          templateId: "",
          generateCount: 1,
          promptSource: "custom",
          templateSource: "",
          lastRequestId: "",
          originRequestId: "",
        }),
        draft_content: JSON.stringify({
          type: "draft",
          id: util.uuid(),
          min_version: DRAFT_VERSION,
          is_from_tsn: true,
          version: DRAFT_VERSION,
          main_component_id: componentId,
          component_list: [
            {
              type: "image_base_component",
              id: componentId,
              min_version: DRAFT_VERSION,
              generate_type: "generate",
              aigc_mode: "workbench",
              abilities: {
                type: "",
                id: util.uuid(),
                generate: {
                  type: "",
                  id: util.uuid(),
                  core_param: {
                    type: "",
                    id: util.uuid(),
                    model,
                    prompt,
                    negative_prompt: negativePrompt,
                    seed: Math.floor(Math.random() * 100000000) + 2500000000,
                    sample_strength: sampleStrength,
                    image_ratio: 1,
                    large_image_info: {
                      type: "",
                      id: util.uuid(),
                      height,
                      width,
                    },
                  },
                  history_option: {
                    type: "",
                    id: util.uuid(),
                  },
                },
              },
            },
          ],
        }),
        http_common_info: {
          aid: Number(DEFAULT_ASSISTANT_ID),
        },
      },
    }
  );
  const historyId = aigc_data.history_record_id;
  console.log('Generated historyId:', historyId);

  if (!historyId) {
    throw new APIException(EX.API_IMAGE_GENERATION_FAILED, '生成ID获取失败');
  }
  return { 
    historyId: aigc_data.history_record_id 
  };
}

export async function getImageByHistoryId(historyId: string, refreshToken: string) {
  const result = await request(
    "post",
    "/mweb/v1/get_history_by_ids",
    refreshToken,
    {
      data: {
        history_ids: [historyId],
        image_info: { width: 2048, height: 2048, format: "webp" },
        http_common_info: { aid: Number(DEFAULT_ASSISTANT_ID) }
      }
    }
  );

  if (!result[historyId]) {
    throw new APIException(EX.API_IMAGE_GENERATION_FAILED, "历史记录不存在");
  }

  const item_list = result[historyId].item_list || [];

  return {
    images: item_list.map(item => ({
      webp: item?.common_attr?.cover_url_map?.["2400"] || "",
      jpeg: item?.image?.large_images?.[0]?.image_url || "",
      cover_1: item?.common_attr?.cover_url_map?.["1080"] || "",
      cover_2: item?.common_attr?.cover_url || ""
    }))
  };
}

export default {
  generateImages,
  getImageByHistoryId,
};
