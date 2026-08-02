ALTER TABLE storyboards ADD COLUMN layout_description TEXT;
ALTER TABLE storyboards ADD COLUMN image_url TEXT;
ALTER TABLE storyboards ADD COLUMN local_path TEXT;
ALTER TABLE storyboards ADD COLUMN main_panel_idx INTEGER;
ALTER TABLE storyboards ADD COLUMN composed_image TEXT;
ALTER TABLE storyboards ADD COLUMN result TEXT;
ALTER TABLE storyboards ADD COLUMN emotion TEXT;
ALTER TABLE storyboards ADD COLUMN emotion_intensity INTEGER;
ALTER TABLE storyboards ADD COLUMN error_msg TEXT;
ALTER TABLE storyboards ADD COLUMN lighting_style TEXT;
ALTER TABLE storyboards ADD COLUMN depth_of_field TEXT;
ALTER TABLE storyboards ADD COLUMN polished_prompt TEXT;
ALTER TABLE storyboards ADD COLUMN continuity_snapshot TEXT;
ALTER TABLE storyboards ADD COLUMN audio_local_path TEXT;
ALTER TABLE storyboards ADD COLUMN narration_audio_local_path TEXT;
ALTER TABLE storyboards ADD COLUMN first_frame_image_id INTEGER;
ALTER TABLE storyboards ADD COLUMN last_frame_image_id INTEGER;
ALTER TABLE storyboards ADD COLUMN last_frame_image_url TEXT;
ALTER TABLE storyboards ADD COLUMN last_frame_local_path TEXT;

ALTER TABLE characters ADD COLUMN extra_images TEXT;
ALTER TABLE characters ADD COLUMN error_msg TEXT;
ALTER TABLE characters ADD COLUMN ref_image TEXT;
ALTER TABLE characters ADD COLUMN seedance2_voice_asset TEXT;

ALTER TABLE scenes ADD COLUMN polished_prompt TEXT;
ALTER TABLE scenes ADD COLUMN extra_images TEXT;
ALTER TABLE scenes ADD COLUMN ref_image TEXT;
ALTER TABLE scenes ADD COLUMN error_msg TEXT;

ALTER TABLE props ADD COLUMN extra_images TEXT;
ALTER TABLE props ADD COLUMN ref_image TEXT;
ALTER TABLE props ADD COLUMN error_msg TEXT;

ALTER TABLE image_generations ADD COLUMN episode_id INTEGER;
ALTER TABLE image_generations ADD COLUMN use_first_frame_layout_lock INTEGER;
ALTER TABLE image_generations ADD COLUMN width INTEGER;
ALTER TABLE image_generations ADD COLUMN height INTEGER;

ALTER TABLE video_generations ADD COLUMN resolution TEXT;
ALTER TABLE video_generations ADD COLUMN seed INTEGER;
ALTER TABLE video_generations ADD COLUMN camera_fixed INTEGER;
ALTER TABLE video_generations ADD COLUMN watermark INTEGER;
ALTER TABLE video_generations ADD COLUMN provider_task_id TEXT;

ALTER TABLE video_merges ADD COLUMN merge_options TEXT;
ALTER TABLE video_merges ADD COLUMN merged_url TEXT;
ALTER TABLE video_merges ADD COLUMN duration INTEGER;
ALTER TABLE video_merges ADD COLUMN completed_at TEXT;
ALTER TABLE video_merges ADD COLUMN error_msg TEXT;
