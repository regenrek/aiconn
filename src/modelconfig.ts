export type ModelConfig = {
  model: string;
  contentField: string;
};

export const modelConfigs: ModelConfig[] = [
  {
    model: "deepseek-reasoner",
    contentField: "reasoning_content",
  },
  {
    model: "deepseek-chat",
    contentField: "content",
  },
];

export const getContentField = (model: string): string => {
  const config = modelConfigs.find((c) => c.model === model);
  return config?.contentField || "content";
};
