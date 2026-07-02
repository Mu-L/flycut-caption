use crate::fsmn_vad::config::{CmvnStats, FrontendConf};
use kaldi_native_fbank::online::FeatureComputer;
use kaldi_native_fbank::{FbankComputer, FbankOptions, OnlineFeature};

pub struct WavFrontend {
    online: OnlineFeature,
    frontend_conf: FrontendConf,
    cmvn: CmvnStats,
}

impl WavFrontend {
    pub fn new(frontend_conf: FrontendConf, cmvn: CmvnStats) -> Result<Self, String> {
        let mut opts = FbankOptions::default();
        opts.frame_opts.samp_freq = frontend_conf.fs as f32;
        opts.frame_opts.frame_shift_ms = frontend_conf.frame_shift as f32;
        opts.frame_opts.frame_length_ms = frontend_conf.frame_length as f32;
        opts.frame_opts.dither = frontend_conf.dither;
        opts.frame_opts.window_type = frontend_conf.window.clone();
        opts.frame_opts.snip_edges = true;
        opts.mel_opts.num_bins = frontend_conf.n_mels;
        opts.use_energy = false;
        opts.energy_floor = 0.0;

        let computer = FeatureComputer::Fbank(
            FbankComputer::new(opts).map_err(|e| format!("创建 FbankComputer 失败：{e}"))?,
        );

        Ok(Self {
            online: OnlineFeature::new(computer),
            frontend_conf,
            cmvn,
        })
    }

    pub fn extract(&mut self, waveform: &[f32]) -> Result<Vec<Vec<f32>>, String> {
        let scaled: Vec<f32> = waveform.iter().map(|s| s * 32768.0).collect();
        self.online
            .accept_waveform(self.frontend_conf.fs as f32, &scaled);
        self.online.input_finished();

        let frames = self.online.num_frames_ready();
        let dim = self.frontend_conf.n_mels;
        let mut feats = Vec::with_capacity(frames);
        for frame_idx in 0..frames {
            let frame = self
                .online
                .get_frame(frame_idx)
                .ok_or_else(|| format!("缺少 fbank 帧 {frame_idx}"))?;
            feats.push(frame[..dim].to_vec());
        }

        let lfr = apply_lfr(&feats, self.frontend_conf.lfr_m, self.frontend_conf.lfr_n);
        Ok(apply_cmvn(&lfr, &self.cmvn))
    }
}

fn apply_lfr(inputs: &[Vec<f32>], lfr_m: usize, lfr_n: usize) -> Vec<Vec<f32>> {
    if inputs.is_empty() {
        return Vec::new();
    }
    if lfr_m == 1 && lfr_n == 1 {
        return inputs.to_vec();
    }

    let dim = inputs[0].len();
    let left_pad = (lfr_m - 1) / 2;
    let mut padded = Vec::with_capacity(left_pad + inputs.len());
    for _ in 0..left_pad {
        padded.push(inputs[0].clone());
    }
    padded.extend_from_slice(inputs);

    let t = padded.len();
    let t_lfr = t.div_ceil(lfr_n);
    let mut outputs = Vec::with_capacity(t_lfr);

    for i in 0..t_lfr {
        let start = i * lfr_n;
        if start + lfr_m <= t {
            let mut frame = Vec::with_capacity(lfr_m * dim);
            for j in 0..lfr_m {
                frame.extend_from_slice(&padded[start + j]);
            }
            outputs.push(frame);
        } else {
            let mut frame = Vec::with_capacity(lfr_m * dim);
            for j in start..t {
                frame.extend_from_slice(&padded[j]);
            }
            while frame.len() < lfr_m * dim {
                frame.extend_from_slice(&padded[t - 1]);
            }
            outputs.push(frame);
        }
    }

    outputs
}

fn apply_cmvn(inputs: &[Vec<f32>], cmvn: &CmvnStats) -> Vec<Vec<f32>> {
    inputs
        .iter()
        .map(|row| {
            row.iter()
                .enumerate()
                .map(|(idx, value)| {
                    let mean = cmvn.means.get(idx).copied().unwrap_or(0.0);
                    let var = cmvn.vars.get(idx).copied().unwrap_or(1.0);
                    (value + mean) * var
                })
                .collect()
        })
        .collect()
}