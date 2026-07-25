const ACTIONS = {
  chat: {
    label: '创作咨询',
    capability: 'text',
    sceneKey: 'assistant_chat',
    executor: 'chat',
    writeMode: 'read',
    riskLevel: 'low',
  },
  generate_story: {
    label: '生成剧本并入库',
    capability: 'structured_text',
    sceneKey: 'story_generation',
    executor: 'story',
    writeMode: 'create',
    riskLevel: 'normal',
  },
  rewrite_current_episode: {
    label: '改写本集剧本并入库',
    capability: 'structured_text',
    sceneKey: 'story_generation',
    executor: 'story',
    writeMode: 'overwrite',
    riskLevel: 'high',
    requiresEpisode: true,
  },
  continue_current_episode: {
    label: '续写本集剧本并入库',
    capability: 'structured_text',
    sceneKey: 'story_generation',
    executor: 'story',
    writeMode: 'append',
    riskLevel: 'normal',
    requiresEpisode: true,
    requiresEpisodeScript: true,
  },
  extract_resources: {
    label: '提取资源说明并入库',
    capability: 'structured_text',
    sceneKey: 'role_extraction',
    executor: 'resource_extraction',
    writeMode: 'upsert',
    riskLevel: 'normal',
    requiresProjectScript: true,
  },
  generate_resource_images: {
    label: '生成资源图片并入库',
    capability: 'image',
    sceneKey: 'role_image_polish',
    executor: 'resource_images',
    writeMode: 'upsert',
    riskLevel: 'normal',
    supportsPreparation: 'extract_resources',
  },
  generate_storyboards: {
    label: '生成全部分镜并入库',
    capability: 'structured_text',
    sceneKey: 'storyboard_extraction',
    executor: 'storyboards',
    writeMode: 'replace',
    riskLevel: 'high',
    requiresEpisode: true,
    requiresEpisodeScript: true,
  },
  generate_storyboard_images: {
    label: '生成分镜图片并入库',
    capability: 'storyboard_image',
    sceneKey: 'storyboard_image_generation',
    executor: 'storyboard_images',
    writeMode: 'upsert',
    riskLevel: 'normal',
    requiresEpisode: true,
    supportsPreparation: 'generate_storyboards',
  },
  generate_image: {
    label: '生成单张素材图并入库',
    capability: 'image',
    sceneKey: 'role_image_polish',
    executor: 'single_image',
    writeMode: 'create',
    riskLevel: 'normal',
  },
  optimize_resource_prompt: {
    label: '优化资源图片提示词并入库',
    capability: 'structured_text',
    sceneKey: 'role_image_polish',
    executor: 'resource_prompt',
    writeMode: 'update',
    riskLevel: 'normal',
    requiresResources: true,
  },
  update_storyboard_details: {
    label: '补充或优化分镜说明并入库',
    capability: 'structured_text',
    sceneKey: 'storyboard_extraction',
    executor: 'storyboard_details',
    writeMode: 'update',
    riskLevel: 'normal',
    requiresEpisode: true,
    requiresStoryboards: true,
  },
  optimize_storyboard_prompt: {
    label: '优化分镜提示词并入库',
    capability: 'structured_text',
    sceneKey: 'frame_prompt',
    executor: 'storyboard_prompt',
    writeMode: 'update',
    riskLevel: 'normal',
    requiresEpisode: true,
    requiresStoryboards: true,
  },
};

const SUPPORTED_ACTIONS = Object.freeze(Object.keys(ACTIONS));

function getActionDefinition(intent) {
  const action = ACTIONS[String(intent || '')] || ACTIONS.chat;
  return { ...action };
}

function count(db, sql, ...params) {
  try {
    return Number(db.prepare(sql).get(...params)?.count || 0);
  } catch (_) {
    return 0;
  }
}

function inspectProjectState(db, session, episode) {
  const dramaId = Number(session?.drama_id);
  const episodeId = Number(episode?.id);
  return {
    episode_count: count(
      db,
      'SELECT COUNT(*) AS count FROM episodes WHERE drama_id = ? AND deleted_at IS NULL',
      dramaId
    ),
    script_count: count(
      db,
      `SELECT COUNT(*) AS count FROM episodes
        WHERE drama_id = ? AND deleted_at IS NULL
          AND TRIM(COALESCE(script_content, '')) <> ''`,
      dramaId
    ),
    resource_count: (
      count(db, 'SELECT COUNT(*) AS count FROM characters WHERE drama_id = ? AND deleted_at IS NULL', dramaId)
      + count(db, 'SELECT COUNT(*) AS count FROM props WHERE drama_id = ? AND deleted_at IS NULL', dramaId)
      + count(db, 'SELECT COUNT(*) AS count FROM scenes WHERE drama_id = ? AND deleted_at IS NULL', dramaId)
    ),
    storyboard_count: episodeId
      ? count(
        db,
        'SELECT COUNT(*) AS count FROM storyboards WHERE episode_id = ? AND deleted_at IS NULL',
        episodeId
      )
      : 0,
    current_episode_has_script: !!String(episode?.script_content || '').trim(),
  };
}

function compileActionPlan(intentDecision) {
  const primaryIntent = SUPPORTED_ACTIONS.includes(intentDecision?.intent)
    ? intentDecision.intent
    : 'chat';
  const primary = getActionDefinition(primaryIntent);
  const requested = (Array.isArray(intentDecision?.requested_actions)
    ? intentDecision.requested_actions
    : [])
    .filter((intent) => SUPPORTED_ACTIONS.includes(intent) && intent !== 'chat');
  const canonicalPreparationOrder = [
    'generate_story',
    'extract_resources',
    'generate_storyboards',
  ];
  const uniqueRequested = [...new Set(requested)];
  const intents = primaryIntent === 'chat'
    ? ['chat']
    : [
      ...canonicalPreparationOrder.filter((intent) => uniqueRequested.includes(intent)),
      ...uniqueRequested.filter((intent) => !canonicalPreparationOrder.includes(intent)),
    ];
  const primaryIndex = intents.indexOf(primaryIntent);
  if (primaryIndex >= 0) intents.splice(primaryIndex, 1);
  if (
    intentDecision?.prepare_source
    && primary.supportsPreparation
    && !intents.includes(primary.supportsPreparation)
  ) {
    intents.push(primary.supportsPreparation);
  }
  intents.push(primaryIntent);

  const preparationOnly = intents.length === 2
    && intents[0] === primary.supportsPreparation;
  const actions = [];
  intents.forEach((intent, index) => {
    const definition = getActionDefinition(intent);
    const isPrimary = index === intents.length - 1;
    const id = isPrimary
      ? 'primary_action'
      : preparationOnly
        ? 'prepare_source'
        : `step_${index + 1}`;
    actions.push({
      id,
      intent,
      label: definition.label,
      capability: definition.capability,
      scene_key: definition.sceneKey,
      executor: definition.executor,
      write_mode: definition.writeMode,
      risk_level: definition.riskLevel,
      depends_on: index ? [actions[index - 1].id] : [],
    });
  });
  return {
    schema_version: '1.0',
    primary_intent: primaryIntent,
    actions,
  };
}

function validateActionPlan(db, session, episode, intentDecision) {
  const action = getActionDefinition(intentDecision?.intent);
  const state = inspectProjectState(db, session, episode);
  if (intentDecision?.intent === 'chat') {
    return {
      allowed: true,
      state,
      missing_inputs: [],
      requires_confirmation: false,
      clarification_question: '',
    };
  }
  const missing = new Set(
    Array.isArray(intentDecision?.missing_inputs)
      ? intentDecision.missing_inputs.filter(Boolean)
      : []
  );
  const requestedActions = Array.isArray(intentDecision?.requested_actions)
    ? intentDecision.requested_actions
    : [];
  const preparesStory = requestedActions.includes('generate_story');
  const preparesResources = requestedActions.includes('extract_resources');
  const preparesStoryboards = requestedActions.includes('generate_storyboards');
  const supportedPreparatoryActions = new Set([
    'generate_story',
    'extract_resources',
    'generate_storyboards',
  ]);
  const unsupportedPreparatoryActions = requestedActions.filter(
    (intent) => intent !== intentDecision?.intent && !supportedPreparatoryActions.has(intent)
  );
  if (unsupportedPreparatoryActions.length) missing.add('unsupported_action_chain');

  if (action.requiresEpisode && !episode) missing.add('current_episode');
  if (
    action.requiresEpisodeScript
    && episode
    && !state.current_episode_has_script
    && !preparesStory
  ) {
    missing.add('current_episode_script');
  }
  if (action.requiresProjectScript && !state.script_count && !preparesStory) {
    missing.add('project_script');
  }
  if (action.requiresResources && !state.resource_count && !preparesResources) {
    missing.add('project_resources');
  }
  if (action.requiresStoryboards && !state.storyboard_count && !preparesStoryboards) {
    missing.add('storyboards');
  }

  if (intentDecision?.intent === 'generate_resource_images' && !state.resource_count) {
    if (state.script_count) {
      intentDecision.prepare_source = true;
    } else if (preparesStory) {
      intentDecision.prepare_source = true;
    } else {
      missing.add('project_script_or_resources');
    }
  }
  if (intentDecision?.intent === 'generate_resource_images' && preparesResources) {
    intentDecision.prepare_source = true;
  }
  if (intentDecision?.intent === 'generate_storyboard_images' && !state.storyboard_count) {
    if (episode && (state.current_episode_has_script || preparesStory)) {
      intentDecision.prepare_source = true;
    } else if (episode) {
      missing.add('current_episode_script_or_storyboards');
    }
  }
  if (intentDecision?.intent === 'generate_storyboard_images' && preparesStoryboards) {
    intentDecision.prepare_source = true;
  }

  const labels = {
    current_episode: '当前剧集',
    current_episode_script: '当前剧集的剧本内容',
    project_script: '项目剧本内容',
    project_resources: '可操作的人物、道具或场景资源',
    storyboards: '当前剧集的分镜',
    project_script_or_resources: '项目剧本或已提取的资源',
    current_episode_script_or_storyboards: '当前剧集剧本或已生成的分镜',
    unsupported_action_chain: '可安全串联的前置动作（生成剧本、提取资源或生成分镜）',
  };
  const missingInputs = [...missing];
  const destructiveProjectStory = intentDecision?.intent === 'generate_story'
    && !episode
    && state.script_count > 0;
  const requestedStoryReplacement = preparesStory
    && intentDecision?.intent !== 'generate_story'
    && (
      (episode && state.current_episode_has_script)
      || (!episode && state.script_count > 0)
    );
  const replacingStoryboards = intentDecision?.intent === 'generate_storyboards'
    && state.storyboard_count > 0;
  const requestedStoryboardReplacement = requestedActions.includes('generate_storyboards')
    && intentDecision?.intent !== 'generate_storyboards'
    && state.storyboard_count > 0;
  const locallyRequiresConfirmation = (
    destructiveProjectStory
      || requestedStoryReplacement
      || replacingStoryboards
      || requestedStoryboardReplacement
  ) && !intentDecision?.force_regenerate && !intentDecision?.confirmation_granted;
  const requiresConfirmation = !!intentDecision?.requires_confirmation
    || locallyRequiresConfirmation;
  const allowed = !missingInputs.length && !requiresConfirmation;
  let clarificationQuestion = String(intentDecision?.clarification_question || '').trim();
  if (!clarificationQuestion && missingInputs.length) {
    clarificationQuestion = `要执行“${action.label}”，请先补充或选择：${missingInputs
      .map((item) => labels[item] || item)
      .join('、')}。`;
  }
  if (!clarificationQuestion && requiresConfirmation) {
    clarificationQuestion = `“${action.label}”会覆盖已有内容，请明确回复“确认继续执行”。`;
  }

  return {
    allowed,
    state,
    missing_inputs: missingInputs,
    requires_confirmation: requiresConfirmation,
    clarification_question: clarificationQuestion,
  };
}

module.exports = {
  ACTIONS,
  SUPPORTED_ACTIONS,
  compileActionPlan,
  getActionDefinition,
  inspectProjectState,
  validateActionPlan,
};
