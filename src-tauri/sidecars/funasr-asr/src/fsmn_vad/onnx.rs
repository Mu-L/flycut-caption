use crate::fsmn_vad::config::EncoderConf;
use ndarray::{Array4, ArrayD};
use std::path::Path;
use std::sync::Arc;
use tract_onnx::prelude::*;

pub struct FsmnOnnxModel {
    model: Arc<RunnableModel<TypedFact, Box<dyn TypedOp>>>,
    cache_count: usize,
    proj_dim: usize,
    lorder: usize,
}

impl FsmnOnnxModel {
    pub fn load(model_path: &Path, encoder: &EncoderConf) -> Result<Self, String> {
        let model = tract_onnx::onnx()
            .model_for_path(model_path)
            .map_err(|e| format!("加载 FSMN ONNX 失败：{e}"))?
            .into_optimized()
            .map_err(|e| format!("优化 FSMN ONNX 失败：{e}"))?
            .into_runnable()
            .map_err(|e| format!("创建 FSMN runnable 失败：{e}"))?;

        Ok(Self {
            model,
            cache_count: encoder.fsmn_layers,
            proj_dim: encoder.proj_dim,
            lorder: encoder.lorder,
        })
    }

    pub fn initial_caches(&self) -> Vec<Array4<f32>> {
        let cache_len = self.lorder.saturating_sub(1);
        (0..self.cache_count)
            .map(|_| Array4::<f32>::zeros((1, self.proj_dim, cache_len, 1)))
            .collect()
    }

    pub fn infer(
        &self,
        feats: &[Vec<f32>],
        caches: &[Array4<f32>],
    ) -> Result<(ArrayD<f32>, Vec<Array4<f32>>), String> {
        if feats.is_empty() {
            return Err("FSMN 推理输入为空".to_string());
        }

        let feat_dim = feats[0].len();
        let t = feats.len();
        let mut flat = Vec::with_capacity(t * feat_dim);
        for frame in feats {
            flat.extend_from_slice(frame);
        }
        let speech_tensor = Tensor::from_shape(&[1, t, feat_dim], &flat)
            .map_err(|e: TractError| format!("构造 speech 张量失败：{e}"))?;

        let mut inputs = tvec![speech_tensor.into_tvalue()];
        for cache in caches {
            let cache_tensor = Tensor::from_shape(&cache.shape(), cache.as_slice().unwrap())
                .map_err(|e: TractError| format!("构造 cache 张量失败：{e}"))?;
            inputs.push(cache_tensor.into_tvalue());
        }

        let outputs = self
            .model
            .run(inputs)
            .map_err(|e: TractError| format!("FSMN ONNX 推理失败：{e}"))?;

        let scores_tensor = outputs[0].clone().into_tensor();
        let scores = scores_tensor
            .to_plain_array_view::<f32>()
            .map_err(|e: TractError| e.to_string())?
            .to_owned()
            .into_dyn();

        let mut out_caches = Vec::with_capacity(self.cache_count);
        for idx in 1..=self.cache_count {
            let cache_tensor = outputs[idx].clone().into_tensor();
            let cache_view = cache_tensor
                .to_plain_array_view::<f32>()
                .map_err(|e: TractError| e.to_string())?;
            let shape = cache_view.shape().to_vec();
            let data: Vec<f32> = cache_view.iter().copied().collect();
            let arr = ArrayD::from_shape_vec(shape, data).map_err(|e| e.to_string())?;
            let arr4 = arr
                .into_dimensionality::<ndarray::Ix4>()
                .map_err(|e| e.to_string())?;
            out_caches.push(arr4);
        }

        Ok((scores, out_caches))
    }
}