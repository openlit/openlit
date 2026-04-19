"""Initializer of Auto Instrumentation of OpenAI Functions"""

import logging
from typing import Collection
import importlib.metadata
from opentelemetry import _logs
from opentelemetry import trace
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from wrapt import wrap_function_wrapper

from openlit._config import OpenlitConfig

logger = logging.getLogger(__name__)
from openlit.instrumentation.openai.openai import (
    chat_completions,
    embedding,
    responses,
    chat_completions_parse,
    image_generate,
    image_variatons,
    audio_create,
    audio_transcription,
    audio_translation,
    image_edit,
    moderation,
    responses_retrieve,
    responses_cancel,
    responses_token_count,
    chat_messages_list,
    batch_create,
    batch_retrieve,
    batch_list,
    batch_cancel,
    fine_tuning_create,
    fine_tuning_retrieve,
    fine_tuning_list,
    fine_tuning_cancel,
    vector_store_create,
    vector_store_retrieve,
    vector_store_update,
    vector_store_delete,
    vector_store_list,
    vector_store_search,
    file_create,
    file_retrieve,
    file_delete,
    file_content,
    video_create,
    video_retrieve,
    video_list,
    video_delete,
    video_edit_op,
    video_extend,
    video_remix,
    conversation_create,
    conversation_retrieve,
    conversation_update,
    conversation_delete,
    conversation_item_create,
    conversation_item_list,
    conversation_item_retrieve,
    conversation_item_delete,
)
from openlit.instrumentation.openai.async_openai import (
    async_chat_completions,
    async_embedding,
    async_chat_completions_parse,
    async_image_generate,
    async_image_variations,
    async_audio_create,
    async_responses,
    async_audio_transcription,
    async_audio_translation,
    async_image_edit,
    async_moderation,
    async_responses_retrieve,
    async_responses_cancel,
    async_responses_token_count,
    async_chat_messages_list,
    async_batch_create,
    async_batch_retrieve,
    async_batch_list,
    async_batch_cancel,
    async_fine_tuning_create,
    async_fine_tuning_retrieve,
    async_fine_tuning_list,
    async_fine_tuning_cancel,
    async_vector_store_create,
    async_vector_store_retrieve,
    async_vector_store_update,
    async_vector_store_delete,
    async_vector_store_list,
    async_vector_store_search,
    async_file_create,
    async_file_retrieve,
    async_file_delete,
    async_file_content,
    async_video_create,
    async_video_retrieve,
    async_video_list,
    async_video_delete,
    async_video_edit_op,
    async_video_extend,
    async_video_remix,
    async_conversation_create,
    async_conversation_retrieve,
    async_conversation_update,
    async_conversation_delete,
    async_conversation_item_create,
    async_conversation_item_list,
    async_conversation_item_retrieve,
    async_conversation_item_delete,
)

_instruments = ("openai >= 1.92.0",)


def _standard_args(
    version,
    environment,
    application_name,
    tracer,
    pricing_info,
    capture_message_content,
    metrics,
    disable_metrics,
    event_provider,
):
    """Return the standard argument tuple used by all wrapper constructors."""
    return (
        version,
        environment,
        application_name,
        tracer,
        pricing_info,
        capture_message_content,
        metrics,
        disable_metrics,
        event_provider,
    )


def _safe_wrap(module, class_method, wrapper):
    """Wrap a function, silently skipping if the module doesn't exist in this SDK version."""
    try:
        wrap_function_wrapper(module, class_method, wrapper)
    except ModuleNotFoundError:
        logger.debug(
            "Skipping %s.%s — module not in this openai version", module, class_method
        )


class OpenAIInstrumentor(BaseInstrumentor):
    """
    An instrumentor for OpenAI client library.
    """

    def instrumentation_dependencies(self) -> Collection[str]:
        return _instruments

    def _instrument(self, **kwargs):
        version = importlib.metadata.version("openai")
        environment = kwargs.get("environment", "default")
        application_name = kwargs.get("application_name", "default")
        tracer = trace.get_tracer(__name__)
        pricing_info = kwargs.get("pricing_info", {})
        capture_message_content = kwargs.get("capture_message_content", False)
        metrics = OpenlitConfig.metrics_dict
        disable_metrics = kwargs.get("disable_metrics")
        event_provider = _logs.get_logger_provider().get_logger(__name__)

        sa = _standard_args(
            version,
            environment,
            application_name,
            tracer,
            pricing_info,
            capture_message_content,
            metrics,
            disable_metrics,
            event_provider,
        )

        # chat completions
        wrap_function_wrapper(
            "openai.resources.chat.completions",
            "Completions.create",
            chat_completions(*sa),
        )
        wrap_function_wrapper(
            "openai.resources.chat.completions",
            "AsyncCompletions.create",
            async_chat_completions(*sa),
        )

        # chat completions parse
        wrap_function_wrapper(
            "openai.resources.chat.completions",
            "Completions.parse",
            chat_completions_parse(*sa),
        )
        wrap_function_wrapper(
            "openai.resources.chat.completions",
            "AsyncCompletions.parse",
            async_chat_completions_parse(*sa),
        )

        # responses
        wrap_function_wrapper(
            "openai.resources.responses.responses",
            "Responses.create",
            responses(*sa),
        )
        wrap_function_wrapper(
            "openai.resources.responses.responses",
            "AsyncResponses.create",
            async_responses(*sa),
        )

        # responses retrieve (may not exist in older SDK versions)
        _safe_wrap(
            "openai.resources.responses.responses",
            "Responses.retrieve",
            responses_retrieve(*sa),
        )
        _safe_wrap(
            "openai.resources.responses.responses",
            "AsyncResponses.retrieve",
            async_responses_retrieve(*sa),
        )

        # responses cancel (may not exist in older SDK versions)
        _safe_wrap(
            "openai.resources.responses.responses",
            "Responses.cancel",
            responses_cancel(*sa),
        )
        _safe_wrap(
            "openai.resources.responses.responses",
            "AsyncResponses.cancel",
            async_responses_cancel(*sa),
        )

        # responses input tokens count (may not exist in older SDK versions)
        _safe_wrap(
            "openai.resources.responses.input_tokens",
            "InputTokens.count",
            responses_token_count(*sa),
        )
        _safe_wrap(
            "openai.resources.responses.input_tokens",
            "AsyncInputTokens.count",
            async_responses_token_count(*sa),
        )

        # chat messages list (may not exist in older SDK versions)
        _safe_wrap(
            "openai.resources.chat.completions.messages",
            "Messages.list",
            chat_messages_list(*sa),
        )
        _safe_wrap(
            "openai.resources.chat.completions.messages",
            "AsyncMessages.list",
            async_chat_messages_list(*sa),
        )

        # embeddings
        wrap_function_wrapper(
            "openai.resources.embeddings",
            "Embeddings.create",
            embedding(*sa),
        )
        wrap_function_wrapper(
            "openai.resources.embeddings",
            "AsyncEmbeddings.create",
            async_embedding(*sa),
        )

        # image generation
        wrap_function_wrapper(
            "openai.resources.images",
            "Images.generate",
            image_generate(*sa),
        )
        wrap_function_wrapper(
            "openai.resources.images",
            "AsyncImages.generate",
            async_image_generate(*sa),
        )

        # image variations
        wrap_function_wrapper(
            "openai.resources.images",
            "Images.create_variation",
            image_variatons(*sa),
        )
        wrap_function_wrapper(
            "openai.resources.images",
            "AsyncImages.create_variation",
            async_image_variations(*sa),
        )

        # image edit
        wrap_function_wrapper(
            "openai.resources.images",
            "Images.edit",
            image_edit(*sa),
        )
        wrap_function_wrapper(
            "openai.resources.images",
            "AsyncImages.edit",
            async_image_edit(*sa),
        )

        # audio generation (TTS)
        wrap_function_wrapper(
            "openai.resources.audio.speech",
            "Speech.create",
            audio_create(*sa),
        )
        wrap_function_wrapper(
            "openai.resources.audio.speech",
            "AsyncSpeech.create",
            async_audio_create(*sa),
        )

        # audio transcription (STT)
        wrap_function_wrapper(
            "openai.resources.audio.transcriptions",
            "Transcriptions.create",
            audio_transcription(*sa),
        )
        wrap_function_wrapper(
            "openai.resources.audio.transcriptions",
            "AsyncTranscriptions.create",
            async_audio_transcription(*sa),
        )

        # audio translation
        wrap_function_wrapper(
            "openai.resources.audio.translations",
            "Translations.create",
            audio_translation(*sa),
        )
        wrap_function_wrapper(
            "openai.resources.audio.translations",
            "AsyncTranslations.create",
            async_audio_translation(*sa),
        )

        # moderations
        _safe_wrap(
            "openai.resources.moderations",
            "Moderations.create",
            moderation(*sa),
        )
        _safe_wrap(
            "openai.resources.moderations",
            "AsyncModerations.create",
            async_moderation(*sa),
        )

        # batch API
        _safe_wrap(
            "openai.resources.batches",
            "Batches.create",
            batch_create(*sa),
        )
        _safe_wrap(
            "openai.resources.batches",
            "AsyncBatches.create",
            async_batch_create(*sa),
        )
        _safe_wrap(
            "openai.resources.batches",
            "Batches.retrieve",
            batch_retrieve(*sa),
        )
        _safe_wrap(
            "openai.resources.batches",
            "AsyncBatches.retrieve",
            async_batch_retrieve(*sa),
        )
        _safe_wrap(
            "openai.resources.batches",
            "Batches.list",
            batch_list(*sa),
        )
        _safe_wrap(
            "openai.resources.batches",
            "AsyncBatches.list",
            async_batch_list(*sa),
        )
        _safe_wrap(
            "openai.resources.batches",
            "Batches.cancel",
            batch_cancel(*sa),
        )
        _safe_wrap(
            "openai.resources.batches",
            "AsyncBatches.cancel",
            async_batch_cancel(*sa),
        )

        # fine-tuning jobs
        _safe_wrap(
            "openai.resources.fine_tuning.jobs.jobs",
            "Jobs.create",
            fine_tuning_create(*sa),
        )
        _safe_wrap(
            "openai.resources.fine_tuning.jobs.jobs",
            "AsyncJobs.create",
            async_fine_tuning_create(*sa),
        )
        _safe_wrap(
            "openai.resources.fine_tuning.jobs.jobs",
            "Jobs.retrieve",
            fine_tuning_retrieve(*sa),
        )
        _safe_wrap(
            "openai.resources.fine_tuning.jobs.jobs",
            "AsyncJobs.retrieve",
            async_fine_tuning_retrieve(*sa),
        )
        _safe_wrap(
            "openai.resources.fine_tuning.jobs.jobs",
            "Jobs.list",
            fine_tuning_list(*sa),
        )
        _safe_wrap(
            "openai.resources.fine_tuning.jobs.jobs",
            "AsyncJobs.list",
            async_fine_tuning_list(*sa),
        )
        _safe_wrap(
            "openai.resources.fine_tuning.jobs.jobs",
            "Jobs.cancel",
            fine_tuning_cancel(*sa),
        )
        _safe_wrap(
            "openai.resources.fine_tuning.jobs.jobs",
            "AsyncJobs.cancel",
            async_fine_tuning_cancel(*sa),
        )

        # vector stores
        _safe_wrap(
            "openai.resources.vector_stores.vector_stores",
            "VectorStores.create",
            vector_store_create(*sa),
        )
        _safe_wrap(
            "openai.resources.vector_stores.vector_stores",
            "AsyncVectorStores.create",
            async_vector_store_create(*sa),
        )
        _safe_wrap(
            "openai.resources.vector_stores.vector_stores",
            "VectorStores.retrieve",
            vector_store_retrieve(*sa),
        )
        _safe_wrap(
            "openai.resources.vector_stores.vector_stores",
            "AsyncVectorStores.retrieve",
            async_vector_store_retrieve(*sa),
        )
        _safe_wrap(
            "openai.resources.vector_stores.vector_stores",
            "VectorStores.update",
            vector_store_update(*sa),
        )
        _safe_wrap(
            "openai.resources.vector_stores.vector_stores",
            "AsyncVectorStores.update",
            async_vector_store_update(*sa),
        )
        _safe_wrap(
            "openai.resources.vector_stores.vector_stores",
            "VectorStores.delete",
            vector_store_delete(*sa),
        )
        _safe_wrap(
            "openai.resources.vector_stores.vector_stores",
            "AsyncVectorStores.delete",
            async_vector_store_delete(*sa),
        )
        _safe_wrap(
            "openai.resources.vector_stores.vector_stores",
            "VectorStores.list",
            vector_store_list(*sa),
        )
        _safe_wrap(
            "openai.resources.vector_stores.vector_stores",
            "AsyncVectorStores.list",
            async_vector_store_list(*sa),
        )
        _safe_wrap(
            "openai.resources.vector_stores.vector_stores",
            "VectorStores.search",
            vector_store_search(*sa),
        )
        _safe_wrap(
            "openai.resources.vector_stores.vector_stores",
            "AsyncVectorStores.search",
            async_vector_store_search(*sa),
        )

        # files API
        _safe_wrap(
            "openai.resources.files",
            "Files.create",
            file_create(*sa),
        )
        _safe_wrap(
            "openai.resources.files",
            "AsyncFiles.create",
            async_file_create(*sa),
        )
        _safe_wrap(
            "openai.resources.files",
            "Files.retrieve",
            file_retrieve(*sa),
        )
        _safe_wrap(
            "openai.resources.files",
            "AsyncFiles.retrieve",
            async_file_retrieve(*sa),
        )
        _safe_wrap(
            "openai.resources.files",
            "Files.delete",
            file_delete(*sa),
        )
        _safe_wrap(
            "openai.resources.files",
            "AsyncFiles.delete",
            async_file_delete(*sa),
        )
        _safe_wrap(
            "openai.resources.files",
            "Files.content",
            file_content(*sa),
        )
        _safe_wrap(
            "openai.resources.files",
            "AsyncFiles.content",
            async_file_content(*sa),
        )

        # video / sora API
        _safe_wrap(
            "openai.resources.videos",
            "Videos.create",
            video_create(*sa),
        )
        _safe_wrap(
            "openai.resources.videos",
            "AsyncVideos.create",
            async_video_create(*sa),
        )
        _safe_wrap(
            "openai.resources.videos",
            "Videos.retrieve",
            video_retrieve(*sa),
        )
        _safe_wrap(
            "openai.resources.videos",
            "AsyncVideos.retrieve",
            async_video_retrieve(*sa),
        )
        _safe_wrap(
            "openai.resources.videos",
            "Videos.list",
            video_list(*sa),
        )
        _safe_wrap(
            "openai.resources.videos",
            "AsyncVideos.list",
            async_video_list(*sa),
        )
        _safe_wrap(
            "openai.resources.videos",
            "Videos.delete",
            video_delete(*sa),
        )
        _safe_wrap(
            "openai.resources.videos",
            "AsyncVideos.delete",
            async_video_delete(*sa),
        )
        _safe_wrap(
            "openai.resources.videos",
            "Videos.edit",
            video_edit_op(*sa),
        )
        _safe_wrap(
            "openai.resources.videos",
            "AsyncVideos.edit",
            async_video_edit_op(*sa),
        )
        _safe_wrap(
            "openai.resources.videos",
            "Videos.extend",
            video_extend(*sa),
        )
        _safe_wrap(
            "openai.resources.videos",
            "AsyncVideos.extend",
            async_video_extend(*sa),
        )
        _safe_wrap(
            "openai.resources.videos",
            "Videos.remix",
            video_remix(*sa),
        )
        _safe_wrap(
            "openai.resources.videos",
            "AsyncVideos.remix",
            async_video_remix(*sa),
        )

        # conversations API
        _safe_wrap(
            "openai.resources.conversations.conversations",
            "Conversations.create",
            conversation_create(*sa),
        )
        _safe_wrap(
            "openai.resources.conversations.conversations",
            "AsyncConversations.create",
            async_conversation_create(*sa),
        )
        _safe_wrap(
            "openai.resources.conversations.conversations",
            "Conversations.retrieve",
            conversation_retrieve(*sa),
        )
        _safe_wrap(
            "openai.resources.conversations.conversations",
            "AsyncConversations.retrieve",
            async_conversation_retrieve(*sa),
        )
        _safe_wrap(
            "openai.resources.conversations.conversations",
            "Conversations.update",
            conversation_update(*sa),
        )
        _safe_wrap(
            "openai.resources.conversations.conversations",
            "AsyncConversations.update",
            async_conversation_update(*sa),
        )
        _safe_wrap(
            "openai.resources.conversations.conversations",
            "Conversations.delete",
            conversation_delete(*sa),
        )
        _safe_wrap(
            "openai.resources.conversations.conversations",
            "AsyncConversations.delete",
            async_conversation_delete(*sa),
        )

        # conversation items
        _safe_wrap(
            "openai.resources.conversations.items",
            "Items.create",
            conversation_item_create(*sa),
        )
        _safe_wrap(
            "openai.resources.conversations.items",
            "AsyncItems.create",
            async_conversation_item_create(*sa),
        )
        _safe_wrap(
            "openai.resources.conversations.items",
            "Items.list",
            conversation_item_list(*sa),
        )
        _safe_wrap(
            "openai.resources.conversations.items",
            "AsyncItems.list",
            async_conversation_item_list(*sa),
        )
        _safe_wrap(
            "openai.resources.conversations.items",
            "Items.retrieve",
            conversation_item_retrieve(*sa),
        )
        _safe_wrap(
            "openai.resources.conversations.items",
            "AsyncItems.retrieve",
            async_conversation_item_retrieve(*sa),
        )
        _safe_wrap(
            "openai.resources.conversations.items",
            "Items.delete",
            conversation_item_delete(*sa),
        )
        _safe_wrap(
            "openai.resources.conversations.items",
            "AsyncItems.delete",
            async_conversation_item_delete(*sa),
        )

    def _uninstrument(self, **kwargs):
        pass
