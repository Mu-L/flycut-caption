use crate::fsmn_vad::config::VadPostConf;
use ndarray::ArrayD;
use std::f64::consts::E;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum VadStateMachine {
    StartPointNotDetected,
    InSpeechSegment,
    EndPointDetected,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FrameState {
    Invalid,
    Speech,
    Sil,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AudioChangeState {
    Speech2Speech,
    Speech2Sil,
    Sil2Sil,
    Sil2Speech,
    NoBegin,
    Invalid,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum VadDetectMode {
    SingleUtterance = 0,
    MultipleUtterance = 1,
}

#[derive(Debug, Clone)]
struct VadSpeechBuf {
    start_ms: i32,
    end_ms: i32,
    contain_seg_start_point: bool,
    contain_seg_end_point: bool,
}

impl VadSpeechBuf {
    fn new() -> Self {
        Self {
            start_ms: 0,
            end_ms: 0,
            contain_seg_start_point: false,
            contain_seg_end_point: false,
        }
    }
}

struct WindowDetector {
    win_size_frame: usize,
    win_sum: i32,
    win_state: Vec<i32>,
    cur_win_pos: usize,
    pre_frame_state: FrameState,
    sil_to_speech_frmcnt_thres: usize,
    speech_to_sil_frmcnt_thres: usize,
    frame_size_ms: i32,
    continous_silence_frame_count: usize,
}

impl WindowDetector {
    fn new(
        window_size_ms: i32,
        sil_to_speech_time: i32,
        speech_to_sil_time: i32,
        frame_size_ms: i32,
    ) -> Self {
        let win_size_frame = (window_size_ms / frame_size_ms) as usize;
        Self {
            win_size_frame,
            win_sum: 0,
            win_state: vec![0; win_size_frame],
            cur_win_pos: 0,
            pre_frame_state: FrameState::Sil,
            sil_to_speech_frmcnt_thres: (sil_to_speech_time / frame_size_ms) as usize,
            speech_to_sil_frmcnt_thres: (speech_to_sil_time / frame_size_ms) as usize,
            frame_size_ms,
            continous_silence_frame_count: 0,
        }
    }

    fn reset(&mut self) {
        self.cur_win_pos = 0;
        self.win_sum = 0;
        self.win_state.fill(0);
        self.pre_frame_state = FrameState::Sil;
        self.continous_silence_frame_count = 0;
    }

    fn get_win_size(&self) -> usize {
        self.win_size_frame
    }

    fn detect_one_frame(&mut self, frame_state: FrameState) -> AudioChangeState {
        let cur = match frame_state {
            FrameState::Speech => 1,
            FrameState::Sil => 0,
            FrameState::Invalid => return AudioChangeState::Invalid,
        };

        self.win_sum -= self.win_state[self.cur_win_pos];
        self.win_sum += cur;
        self.win_state[self.cur_win_pos] = cur;
        self.cur_win_pos = (self.cur_win_pos + 1) % self.win_size_frame;

        if self.pre_frame_state == FrameState::Sil
            && self.win_sum as usize >= self.sil_to_speech_frmcnt_thres
        {
            self.pre_frame_state = FrameState::Speech;
            return AudioChangeState::Sil2Speech;
        }

        if self.pre_frame_state == FrameState::Speech
            && self.win_sum as usize <= self.speech_to_sil_frmcnt_thres
        {
            self.pre_frame_state = FrameState::Sil;
            return AudioChangeState::Speech2Sil;
        }

        if self.pre_frame_state == FrameState::Sil {
            AudioChangeState::Sil2Sil
        } else if self.pre_frame_state == FrameState::Speech {
            AudioChangeState::Speech2Speech
        } else {
            AudioChangeState::Invalid
        }
    }
}

pub struct E2EVadModel {
    opts: VadPostConf,
    windows_detector: WindowDetector,
    data_buf_start_frame: i32,
    frm_cnt: i32,
    latest_confirmed_speech_frame: i32,
    lastest_confirmed_silence_frame: i32,
    continous_silence_frame_count: i32,
    vad_state_machine: VadStateMachine,
    confirmed_start_frame: i32,
    confirmed_end_frame: i32,
    number_end_time_detected: i32,
    sil_frame: i32,
    sil_pdf_ids: Vec<usize>,
    noise_average_decibel: f64,
    pre_end_silence_detected: bool,
    output_data_buf: Vec<VadSpeechBuf>,
    output_data_buf_offset: usize,
    max_end_sil_frame_cnt_thresh: i32,
    speech_noise_thres: f64,
    scores: Option<ArrayD<f32>>,
    idx_pre_chunk: i32,
    decibel: Vec<f64>,
    data_buf_all_size: i32,
    data_buf_size: i32,
}

impl E2EVadModel {
    pub fn new(opts: VadPostConf) -> Self {
        let windows_detector = WindowDetector::new(
            opts.window_size_ms,
            opts.sil_to_speech_time_thres,
            opts.speech_to_sil_time_thres,
            opts.frame_in_ms,
        );
        let sil_pdf_ids = opts.sil_pdf_ids.clone();
        let max_end_sil_frame_cnt_thresh =
            opts.max_end_silence_time - opts.speech_to_sil_time_thres;
        let speech_noise_thres = opts.speech_noise_thres;

        let mut model = Self {
            opts,
            windows_detector,
            data_buf_start_frame: 0,
            frm_cnt: 0,
            latest_confirmed_speech_frame: 0,
            lastest_confirmed_silence_frame: -1,
            continous_silence_frame_count: 0,
            vad_state_machine: VadStateMachine::StartPointNotDetected,
            confirmed_start_frame: -1,
            confirmed_end_frame: -1,
            number_end_time_detected: 0,
            sil_frame: 0,
            sil_pdf_ids,
            noise_average_decibel: -100.0,
            pre_end_silence_detected: false,
            output_data_buf: Vec::new(),
            output_data_buf_offset: 0,
            max_end_sil_frame_cnt_thresh,
            speech_noise_thres,
            scores: None,
            idx_pre_chunk: 0,
            decibel: Vec::new(),
            data_buf_all_size: 0,
            data_buf_size: 0,
        };
        model.reset_detection();
        model
    }

    fn reset_detection(&mut self) {
        self.continous_silence_frame_count = 0;
        self.latest_confirmed_speech_frame = 0;
        self.lastest_confirmed_silence_frame = -1;
        self.confirmed_start_frame = -1;
        self.confirmed_end_frame = -1;
        self.vad_state_machine = VadStateMachine::StartPointNotDetected;
        self.windows_detector.reset();
        self.sil_frame = 0;
    }

    fn all_reset_detection(&mut self) {
        self.data_buf_start_frame = 0;
        self.frm_cnt = 0;
        self.output_data_buf.clear();
        self.output_data_buf_offset = 0;
        self.decibel.clear();
        self.data_buf_all_size = 0;
        self.data_buf_size = 0;
        self.scores = None;
        self.idx_pre_chunk = 0;
        self.number_end_time_detected = 0;
        self.noise_average_decibel = -100.0;
        self.pre_end_silence_detected = false;
        self.reset_detection();
    }

    fn compute_decibel(&mut self, waveform: &[f32]) {
        let frame_sample_length =
            (self.opts.frame_length_ms * self.opts.sample_rate / 1000) as usize;
        let frame_shift_length = (self.opts.frame_in_ms * self.opts.sample_rate / 1000) as usize;

        if self.data_buf_all_size == 0 {
            self.data_buf_all_size = waveform.len() as i32;
            self.data_buf_size = self.data_buf_all_size;
        } else {
            self.data_buf_all_size += waveform.len() as i32;
        }

        let mut offset = 0usize;
        while offset + frame_sample_length <= waveform.len() {
            let energy: f32 = waveform[offset..offset + frame_sample_length]
                .iter()
                .map(|v| v * v)
                .sum();
            self.decibel
                .push(10.0 * (energy as f64 + 0.000001).log10());
            offset += frame_shift_length;
        }
    }

    fn compute_scores(&mut self, scores: ArrayD<f32>) {
        let block = scores.shape()[1] as i32;
        self.frm_cnt += block;
        self.scores = Some(scores);
    }

    fn pop_data_buf_till_frame(&mut self, frame_idx: i32) {
        let frame_shift_samples =
            self.opts.frame_in_ms * self.opts.sample_rate / 1000;
        while self.data_buf_start_frame < frame_idx {
            if self.data_buf_size >= frame_shift_samples {
                self.data_buf_start_frame += 1;
                self.data_buf_size =
                    self.data_buf_all_size - self.data_buf_start_frame * frame_shift_samples;
            } else {
                break;
            }
        }
    }

    fn pop_data_to_output_buf(
        &mut self,
        start_frm: i32,
        frm_cnt: i32,
        first_frm_is_start_point: bool,
        last_frm_is_end_point: bool,
        end_point_is_sent_end: bool,
    ) {
        self.pop_data_buf_till_frame(start_frm);
        let mut expected_sample_number =
            (frm_cnt * self.opts.sample_rate * self.opts.frame_in_ms / 1000) as i32;
        if last_frm_is_end_point {
            let extra = (self.opts.frame_length_ms * self.opts.sample_rate / 1000
                - self.opts.sample_rate * self.opts.frame_in_ms / 1000)
                .max(0);
            expected_sample_number += extra;
        }
        if end_point_is_sent_end {
            expected_sample_number = expected_sample_number.max(self.data_buf_size);
        }

        if self.output_data_buf.is_empty() || first_frm_is_start_point {
            self.output_data_buf.push(VadSpeechBuf::new());
            let cur = self.output_data_buf.last_mut().unwrap();
            cur.start_ms = start_frm * self.opts.frame_in_ms;
            cur.end_ms = cur.start_ms;
        }

        let data_to_pop = if end_point_is_sent_end {
            expected_sample_number
        } else {
            frm_cnt * self.opts.sample_rate * self.opts.frame_in_ms / 1000
        }
        .min(self.data_buf_size);

        self.data_buf_start_frame += frm_cnt;
        let cur = self.output_data_buf.last_mut().unwrap();
        cur.end_ms = (start_frm + frm_cnt) * self.opts.frame_in_ms;
        if first_frm_is_start_point {
            cur.contain_seg_start_point = true;
        }
        if last_frm_is_end_point {
            cur.contain_seg_end_point = true;
        }
        let _ = data_to_pop;
    }

    fn on_silence_detected(&mut self, valid_frame: i32) {
        self.lastest_confirmed_silence_frame = valid_frame;
        if self.vad_state_machine == VadStateMachine::StartPointNotDetected {
            self.pop_data_buf_till_frame(valid_frame);
        }
    }

    fn on_voice_detected(&mut self, valid_frame: i32) {
        self.latest_confirmed_speech_frame = valid_frame;
        self.pop_data_to_output_buf(valid_frame, 1, false, false, false);
    }

    fn on_voice_start(&mut self, start_frame: i32, fake_result: bool) {
        if self.confirmed_start_frame == -1 {
            self.confirmed_start_frame = start_frame;
        }
        if !fake_result
            && self.vad_state_machine == VadStateMachine::StartPointNotDetected
        {
            self.pop_data_to_output_buf(self.confirmed_start_frame, 1, true, false, false);
        }
    }

    fn on_voice_end(&mut self, end_frame: i32, fake_result: bool, is_last_frame: bool) {
        for t in (self.latest_confirmed_speech_frame + 1)..end_frame {
            self.on_voice_detected(t);
        }
        if self.confirmed_end_frame == -1 {
            self.confirmed_end_frame = end_frame;
        }
        if !fake_result {
            self.sil_frame = 0;
            self.pop_data_to_output_buf(self.confirmed_end_frame, 1, false, true, is_last_frame);
        }
        self.number_end_time_detected += 1;
    }

    fn maybe_on_voice_end_if_last_frame(&mut self, is_final_frame: bool, cur_frm_idx: i32) {
        if is_final_frame {
            self.on_voice_end(cur_frm_idx, false, true);
            self.vad_state_machine = VadStateMachine::EndPointDetected;
        }
    }

    fn latency_frm_num_at_start_point(&self) -> i32 {
        let mut vad_latency = self.windows_detector.get_win_size() as i32;
        if self.opts.do_extend != 0 {
            vad_latency += self.opts.lookback_time_start_point / self.opts.frame_in_ms;
        }
        vad_latency
    }

    fn get_frame_state(&mut self, t: i32) -> FrameState {
        let t_idx = t as usize;
        if t_idx >= self.decibel.len() {
            return FrameState::Sil;
        }

        let cur_decibel = self.decibel[t_idx];
        let cur_snr = cur_decibel - self.noise_average_decibel;
        if cur_decibel < self.opts.decibel_thres {
            return FrameState::Sil;
        }

        let scores = self.scores.as_ref().unwrap();
        let local_t = (t - self.idx_pre_chunk) as usize;
        if local_t >= scores.shape()[1] {
            return FrameState::Sil;
        }

        let sil_sum: f32 = self
            .sil_pdf_ids
            .iter()
            .map(|&id| scores[[0, local_t, id]])
            .sum();
        let noise_prob = (sil_sum as f64).ln() * self.opts.speech_2_noise_ratio;
        let speech_sum = 1.0_f32 - sil_sum;
        let speech_prob = (speech_sum as f64).ln();

        if E.powf(speech_prob) >= E.powf(noise_prob) + self.speech_noise_thres {
            if cur_snr >= self.opts.snr_thres && cur_decibel >= self.opts.decibel_thres {
                FrameState::Speech
            } else {
                FrameState::Sil
            }
        } else {
            if self.noise_average_decibel < -99.9 {
                self.noise_average_decibel = cur_decibel;
            } else {
                self.noise_average_decibel = (cur_decibel
                    + self.noise_average_decibel
                        * (self.opts.noise_frame_num_used_for_snr - 1) as f64)
                    / self.opts.noise_frame_num_used_for_snr as f64;
            }
            FrameState::Sil
        }
    }

    pub fn process_chunk(
        &mut self,
        scores: ArrayD<f32>,
        waveform: &[f32],
        is_final: bool,
        max_end_sil: i32,
    ) -> Vec<[i32; 2]> {
        self.max_end_sil_frame_cnt_thresh = max_end_sil - self.opts.speech_to_sil_time_thres;
        self.compute_decibel(waveform);
        self.compute_scores(scores);

        let block = self.scores.as_ref().unwrap().shape()[1] as i32;
        if !is_final {
            for i in (0..block).rev() {
                let frame_state = self.get_frame_state(self.frm_cnt - 1 - i);
                self.detect_one_frame(frame_state, self.frm_cnt - 1 - i, false);
            }
        } else {
            for i in (0..block).rev() {
                let frame_state = self.get_frame_state(self.frm_cnt - 1 - i);
                if i != 0 {
                    self.detect_one_frame(frame_state, self.frm_cnt - 1 - i, false);
                } else {
                    self.detect_one_frame(frame_state, self.frm_cnt - 1, true);
                }
            }
        }
        self.idx_pre_chunk += block;

        let mut segments = Vec::new();
        for i in self.output_data_buf_offset..self.output_data_buf.len() {
            let seg = &self.output_data_buf[i];
            if !is_final && (!seg.contain_seg_start_point || !seg.contain_seg_end_point) {
                continue;
            }
            segments.push([seg.start_ms, seg.end_ms]);
            self.output_data_buf_offset += 1;
        }

        if is_final {
            self.all_reset_detection();
        }

        segments
    }

    fn detect_one_frame(&mut self, cur_frm_state: FrameState, cur_frm_idx: i32, is_final_frame: bool) {
        let tmp_cur_frm_state = match cur_frm_state {
            FrameState::Speech => {
                if 1.0_f64 > self.opts.fe_prior_thres {
                    FrameState::Speech
                } else {
                    FrameState::Sil
                }
            }
            FrameState::Sil => FrameState::Sil,
            FrameState::Invalid => return,
        };

        let state_change = self.windows_detector.detect_one_frame(tmp_cur_frm_state);
        let frm_shift_in_ms = self.opts.frame_in_ms;

        match state_change {
            AudioChangeState::Sil2Speech => {
                self.continous_silence_frame_count = 0;
                self.pre_end_silence_detected = false;
                if self.vad_state_machine == VadStateMachine::StartPointNotDetected {
                    let start_frame = self
                        .data_buf_start_frame
                        .max(cur_frm_idx - self.latency_frm_num_at_start_point());
                    self.on_voice_start(start_frame, false);
                    self.vad_state_machine = VadStateMachine::InSpeechSegment;
                    for t in (start_frame + 1)..=cur_frm_idx {
                        self.on_voice_detected(t);
                    }
                } else if self.vad_state_machine == VadStateMachine::InSpeechSegment {
                    for t in (self.latest_confirmed_speech_frame + 1)..cur_frm_idx {
                        self.on_voice_detected(t);
                    }
                    if cur_frm_idx - self.confirmed_start_frame + 1
                        > self.opts.max_single_segment_time / frm_shift_in_ms
                    {
                        self.on_voice_end(cur_frm_idx, false, false);
                        self.vad_state_machine = VadStateMachine::EndPointDetected;
                    } else if !is_final_frame {
                        self.on_voice_detected(cur_frm_idx);
                    } else {
                        self.maybe_on_voice_end_if_last_frame(is_final_frame, cur_frm_idx);
                    }
                }
            }
            AudioChangeState::Speech2Sil => {
                self.continous_silence_frame_count = 0;
                if self.vad_state_machine == VadStateMachine::InSpeechSegment {
                    if cur_frm_idx - self.confirmed_start_frame + 1
                        > self.opts.max_single_segment_time / frm_shift_in_ms
                    {
                        self.on_voice_end(cur_frm_idx, false, false);
                        self.vad_state_machine = VadStateMachine::EndPointDetected;
                    } else if !is_final_frame {
                        self.on_voice_detected(cur_frm_idx);
                    } else {
                        self.maybe_on_voice_end_if_last_frame(is_final_frame, cur_frm_idx);
                    }
                }
            }
            AudioChangeState::Speech2Speech => {
                self.continous_silence_frame_count = 0;
                if self.vad_state_machine == VadStateMachine::InSpeechSegment {
                    if cur_frm_idx - self.confirmed_start_frame + 1
                        > self.opts.max_single_segment_time / frm_shift_in_ms
                    {
                        self.on_voice_end(cur_frm_idx, false, false);
                        self.vad_state_machine = VadStateMachine::EndPointDetected;
                    } else if !is_final_frame {
                        self.on_voice_detected(cur_frm_idx);
                    } else {
                        self.maybe_on_voice_end_if_last_frame(is_final_frame, cur_frm_idx);
                    }
                }
            }
            AudioChangeState::Sil2Sil => {
                self.continous_silence_frame_count += 1;
                if self.vad_state_machine == VadStateMachine::StartPointNotDetected {
                    if (self.opts.detect_mode == VadDetectMode::SingleUtterance as i32
                        && self.continous_silence_frame_count * frm_shift_in_ms
                            > self.opts.max_start_silence_time)
                        || (is_final_frame && self.number_end_time_detected == 0)
                    {
                        for t in (self.lastest_confirmed_silence_frame + 1)..cur_frm_idx {
                            self.on_silence_detected(t);
                        }
                        self.on_voice_start(0, true);
                        self.on_voice_end(0, true, false);
                        self.vad_state_machine = VadStateMachine::EndPointDetected;
                    } else if cur_frm_idx >= self.latency_frm_num_at_start_point() {
                        self.on_silence_detected(
                            cur_frm_idx - self.latency_frm_num_at_start_point(),
                        );
                    }
                } else if self.vad_state_machine == VadStateMachine::InSpeechSegment {
                    if self.continous_silence_frame_count * frm_shift_in_ms
                        >= self.max_end_sil_frame_cnt_thresh
                    {
                        let mut lookback_frame =
                            self.max_end_sil_frame_cnt_thresh / frm_shift_in_ms;
                        if self.opts.do_extend != 0 {
                            lookback_frame -=
                                self.opts.lookahead_time_end_point / frm_shift_in_ms;
                            lookback_frame -= 1;
                            lookback_frame = lookback_frame.max(0);
                        }
                        self.on_voice_end(cur_frm_idx - lookback_frame, false, false);
                        self.vad_state_machine = VadStateMachine::EndPointDetected;
                    } else if cur_frm_idx - self.confirmed_start_frame + 1
                        > self.opts.max_single_segment_time / frm_shift_in_ms
                    {
                        self.on_voice_end(cur_frm_idx, false, false);
                        self.vad_state_machine = VadStateMachine::EndPointDetected;
                    } else if self.opts.do_extend != 0 && !is_final_frame {
                        if self.continous_silence_frame_count
                            <= (self.opts.lookahead_time_end_point / frm_shift_in_ms) as i32
                        {
                            self.on_voice_detected(cur_frm_idx);
                        }
                    } else {
                        self.maybe_on_voice_end_if_last_frame(is_final_frame, cur_frm_idx);
                    }
                }
            }
            _ => {}
        }

        if self.vad_state_machine == VadStateMachine::EndPointDetected
            && self.opts.detect_mode == VadDetectMode::MultipleUtterance as i32
        {
            self.reset_detection();
        }
    }
}