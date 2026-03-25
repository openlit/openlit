export const DATABASE_CONFIG_NOT_FOUND = "कोई डेटाबेस कॉन्फ़िगरेशन मौजूद नहीं है!";
export const UNAUTHORIZED_USER = "अनधिकृत उपयोगकर्ता!";
export const MALFORMED_INPUTS = "गलत इनपुट! कृपया डॉक्स देखें";
export const OPERATION_FAILED = "ऑपरेशन विफल रहा!";

// API Keys
export const NO_API_KEY = "ऐसी कोई API की मौजूद नहीं है!";

// Prompts
export const PROMPT_NAME_TAKEN = "प्रॉम्प्ट का नाम पहले से लिया गया है!";
export const PROMPT_NOT_CREATED = "प्रॉम्प्ट बनाया नहीं जा सकता!";
export const PROMPT_SAVED = "प्रॉम्प्ट सफलतापूर्वक सेव हो गया!";
export const NO_PROMPT = "ऐसा कोई प्रॉम्प्ट मौजूद नहीं है या अभी तक रिलीज़ नहीं हुआ है!";
export const PROMPT_DELETED = "प्रॉम्प्ट सफलतापूर्वक डिलीट हो गया!";
export const PROMPT_NOT_DELETED = "प्रॉम्प्ट डिलीट करने में त्रुटि!";
export const VERSION_NOT_CREATED = "संस्करण बनाया नहीं जा सकता";
export const VERSION_NOT_SAVED = "संस्करण सेव नहीं किया जा सकता";
export const VERSION_SAVED = "प्रॉम्प्ट संस्करण सफलतापूर्वक सेव हो गया!";
export const DOWNLOAD_INFO_NOT_SAVED = "डाउनलोड जानकारी सेव नहीं की जा सकती!";
export const PROMPT_TIPS_TO_USE_VARIABLES = "टिप: वेरिएबल जोड़ने के लिए {{variableName}} का उपयोग करें";

// Vault
export const SECRET_NAME_TAKEN = "सीक्रेट का नाम पहले से लिया गया है!";
export const SECRET_SAVED = "सीक्रेट सफलतापूर्वक सेव हो गया!";
export const SECRET_NOT_SAVED = "सीक्रेट सेव नहीं किया जा सकता";
export const SECRET_DELETED = "सीक्रेट सफलतापूर्वक डिलीट हो गया!";
export const SECRET_NOT_DELETED = "सीक्रेट डिलीट करने में त्रुटि!";

// Evaluations
export const EVALUATION_CONFIG_NOT_FOUND = "इवैल्यूएशन कॉन्फ़िगरेशन सेट नहीं है!";
export const EVALUATION_VAULT_SECRET_NOT_FOUND =
	"प्रोवाइडर के लिए इवैल्यूएशन सीक्रेट नहीं मिला!";
export const EVALUATION_CONFIG_SET_ERROR = "इवैल्यूएशन कॉन्फ़िगरेशन सेट नहीं किया जा सकता!";
export const EVALUATION_CONFIG_NOT_SET =
	"इवैल्यूएशन कॉन्फ़िगरेशन सेट नहीं है! कृपया इवैल्यूएशन चलाने के लिए पहले कॉन्फ़िगरेशन सेट करें।";
export const EVALUATION_CONFIG_SET = "इवैल्यूएशन सेटअप करें!";
export const EVALUATION_NOT_RUN_YET =
	"इवैल्यूएशन अभी तक नहीं चलाया गया! परिणाम प्राप्त करने के लिए कृपया इवैल्यूएशन चलाएं।";
export const EVALUATION_RUN = "इवैल्यूएशन चलाएं";
export const EVALUATION_RUN_AGAIN = "इवैल्यूएशन फिर से चलाएं";
export const EVALUATION_DATA_LOADING = "इवैल्यूएशन डेटा लोड हो रहा है...";
export const EVALUATION_CREATED = "इवैल्यूएशन सफलतापूर्वक बनाया गया!";
export const EVALUATION_UPDATED = "इवैल्यूएशन सफलतापूर्वक अपडेट हुआ!";
export const EVALUATION_CONFIG_MODIFYING = "इवैल्यूएशन कॉन्फ़िगरेशन संशोधित हो रहा है...";
export const EVALUATION_CONFIG_INVALID = "अमान्य इवैल्यूएशन कॉन्फ़िगरेशन!";
export const EVALUATION_CONFIG_UPDATING_FAILED =
	"इवैल्यूएशन कॉन्फ़िगरेशन अपडेट विफल रहा!";
export const EVALUATION_RUN_FAILURE = "इवैल्यूएशन चलाना विफल रहा!";

// Evaluation Settings page
export const EVALUATION_VAULT_KEY_NOT_FOUND = "वॉल्ट कुंजी नहीं मिली।";
export const EVALUATION_CREATE_NEW = "नया बनाएं";
export const EVALUATION_ENGINE_TITLE = "इवैल्यूएशन इंजन";
export const EVALUATION_ENGINE_DESCRIPTION =
	"इवैल्यूएशन फ्रेमवर्क चुनें। रूल इंजन कॉन्टेक्स्ट और इवैल्यूएशन टाइप मैनुअल और ऑटो दोनों रन के लिए लागू होते हैं।";
export const EVALUATION_ENGINE_LABEL = "इंजन";
export const EVALUATION_CONFIG_SECTION = "कॉन्फ़िगरेशन";
export const EVALUATION_PROVIDER_LABEL = "प्रोवाइडर";
export const EVALUATION_SELECT_PROVIDER = "प्रोवाइडर चुनें";
export const EVALUATION_MODEL_LABEL = "मॉडल";
export const EVALUATION_SELECT_MODEL = "मॉडल चुनें";
export const EVALUATION_MODEL_PLACEHOLDER =
	"उदाहरण: gpt-4o-mini या कस्टम मॉडल नाम";
export const EVALUATION_MODEL_CUSTOM_HINT =
	"सुझावों से चुनें या प्रोवाइडर द्वारा समर्थित कोई भी मॉडल नाम टाइप करें।";
export const EVALUATION_SELECT_PROVIDER_FIRST = "पहले प्रोवाइडर चुनें";
export const EVALUATION_API_KEY_VAULT = "API कुंजी (वॉल्ट)";
export const EVALUATION_SELECT_VAULT_KEY = "वॉल्ट कुंजी चुनें";
export const EVALUATION_AUTO_TITLE = "ऑटो इवैल्यूएशन";
export const EVALUATION_AUTO_DESCRIPTION =
	"डिफ़ॉल्ट रूप से Hallucination, Bias और Toxicity चलाता है। रूल इंजन ट्रेस का मूल्यांकन करता है, कॉन्टेक्स्ट लाता है और शेड्यूल पर इवैल्यूएशन चलाता है।";
export const EVALUATION_ENABLE_AUTO = "ऑटो इवैल्यूएशन सक्षम करें";
export const EVALUATION_ENABLE_AUTO_DESCRIPTION =
	"शेड्यूल पर नए ट्रेस का मूल्यांकन करें";
export const EVALUATION_CRON_SCHEDULE = "क्रॉन शेड्यूल";
export const EVALUATION_CRON_PLACEHOLDER = "* * * * *";
export const EVALUATION_CRON_HELP =
	"मानक क्रॉन एक्सप्रेशन (उदाहरण: प्रति घंटे के लिए 0 * * * *)";
export const EVALUATION_SAVING = "सहेज रहे हैं...";
export const EVALUATION_SAVE_CHANGES = "बदलाव सहेजें";
export const EVALUATION_CREATE_CONFIG = "कॉन्फ़िग बनाएं";
export const EVALUATION_MANUAL_TITLE = "मैनुअल इवैल्यूएशन";
export const EVALUATION_MANUAL_DESCRIPTION =
	"ट्रेस रिक्वेस्ट विवरण से मैन्युअल रूप से इवैल्यूएशन चलाएं। मैनुअल रन source=manual के साथ ClickHouse में संग्रहीत होते हैं।";
export const EVALUATION_MANUAL_STEP_1 =
	"रिक्वेस्ट पर जाएं और चैट/कम्प्लीशन टाइप के साथ एक ट्रेस खोलें";
export const EVALUATION_MANUAL_STEP_2 =
	"ट्रेस विवरण में इवैल्यूएशन टैब पर क्लिक करें";
export const EVALUATION_MANUAL_STEP_3 =
	'इवैल्यूएशन चलाने के लिए "Run Evaluation" पर क्लिक करें';
export const EVALUATION_GO_TO_REQUESTS = "रिक्वेस्ट पर जाएं";
export const EVALUATION_MANUAL_AND_AUTO = "मैनुअल & ऑटो";
export const EVALUATION_MANUAL_AND_AUTO_DESCRIPTION =
	"मैनुअल और ऑटो इवैल्यूएशन रूल इंजन कॉन्टेक्स्ट का उपयोग करते हैं जब नियम ट्रेस से मेल खाते हैं। मैनुअल रन source=manual के साथ संग्रहीत होते हैं; ऑटो रन source=auto का उपयोग करते हैं।";

// Manual feedback
export const EVALUATION_MANUAL_FEEDBACK = "मैनुअल फीडबैक";
export const EVALUATION_MANUAL_FEEDBACK_DESCRIPTION =
	"इस प्रतिक्रिया पर अपना फीडबैक जोड़ें";
export const EVALUATION_FEEDBACK_POSITIVE = "अच्छा";
export const EVALUATION_FEEDBACK_NEGATIVE = "खराब";
export const EVALUATION_FEEDBACK_NEUTRAL = "तटस्थ";
export const EVALUATION_FEEDBACK_COMMENT_PLACEHOLDER = "वैकल्पिक टिप्पणी...";
export const EVALUATION_FEEDBACK_SUBMIT = "फीडबैक सबमिट करें";
export const EVALUATION_FEEDBACK_SAVED = "फीडबैक सहेजा गया!";

// Traces
export const TRACE_NOT_FOUND = "ट्रेस नहीं मिला!";
export const TRACE_FETCHING_ERROR = "ट्रेस प्राप्त करने में त्रुटि!";

// Cron
export const CRON_RECURRING_TIME_INVALID =
	"अमान्य क्रॉन शेड्यूल। कृपया फ़ॉर्मेट जांचें।";
export const CRON_JOB_UPDATION_ERROR = "क्रॉन जॉब अपडेट करने में त्रुटि।";

// Manage Dashboard
export const BOARD_DATA_NOT_FOUND = "बोर्ड डेटा नहीं मिला!";
export const MANAGE_DASHBOARD_EXPLORER_EMPTY_STATE =
	"अभी तक कोई डैशबोर्ड या फ़ोल्डर नहीं है। बनाने के लिए 'Add' पर क्लिक करें।";
export const BOARD_UPDATE_FAILED = "बोर्ड अपडेट विफल रहा!";
export const BOARD_UPDATED_SUCCESSFULLY = "बोर्ड सफलतापूर्वक अपडेट हुआ!";
export const FOLDER_UPDATE_FAILED = "फ़ोल्डर अपडेट विफल रहा!";
export const FOLDER_UPDATED_SUCCESSFULLY = "फ़ोल्डर सफलतापूर्वक अपडेट हुआ!";
export const WIDGET_UPDATE_FAILED = "विजेट अपडेट विफल रहा!";
export const WIDGET_CREATE_FAILED = "विजेट बनाना विफल रहा!";
export const WIDGET_UPDATED_SUCCESSFULLY = "विजेट सफलतापूर्वक अपडेट हुआ!";
export const BOARD_LAYOUT_UPDATED_SUCCESSFULLY =
	"बोर्ड लेआउट सफलतापूर्वक अपडेट हुआ!";
export const WIDGET_FETCH_FAILED = "विजेट प्राप्त करना विफल रहा!";
export const WIDGET_RUN_FAILED = "विजेट चलाना विफल रहा!";
export const BOARD_DELETE_FAILED = "बोर्ड डिलीट विफल रहा!";
export const BOARD_DELETED_SUCCESSFULLY = "बोर्ड सफलतापूर्वक डिलीट हुआ!";
export const FOLDER_DELETE_FAILED =
	"फ़ोल्डर डिलीट नहीं किया जा सकता! इसमें बोर्ड या फ़ोल्डर हैं।";
export const FOLDER_DELETED_SUCCESSFULLY = "फ़ोल्डर सफलतापूर्वक डिलीट हुआ!";
export const MAIN_DASHBOARD_NOT_FOUND = "मुख्य डैशबोर्ड नहीं मिला!";
export const BOARD_CREATE_FAILED = "बोर्ड बनाना विफल रहा!";
export const BOARD_IMPORT_FAILED = "बोर्ड इम्पोर्ट विफल रहा!";
export const BOARD_IMPORT_SUCCESSFULLY = "बोर्ड सफलतापूर्वक इम्पोर्ट हुआ!";
export const NO_WIDGETS_YET = "अभी तक कोई विजेट नहीं!";
export const NO_WIDGETS_YET_DESCRIPTION = "अपना पहला विजेट बनाएं और अपना कस्टम डैशबोर्ड बनाना शुरू करें। अपने डेटा को विज़ुअलाइज़ करने के लिए चार्ट, स्टैट्स और बहुत कुछ जोड़ें।";
export const NO_WIDGETS_YET_ACTION_BUTTON = "अपना पहला विजेट जोड़ें";
export const NO_DASHBOARDS_YET = "अभी तक कोई डैशबोर्ड नहीं";
export const NO_DASHBOARDS_YET_DESCRIPTION = "अपना डेटा सार्थक तरीके से विज़ुअलाइज़ करने के लिए अपना पहला डैशबोर्ड बनाएं।";
export const NO_DASHBOARDS_YET_ACTION_BUTTON = "डैशबोर्ड बनाएं";
export const NO_DASHBOARDS_YET_SEARCH_TITLE = "कोई डैशबोर्ड नहीं मिला";
export const NO_DASHBOARDS_YET_SEARCH_DESCRIPTION = "आपकी खोज से मेल खाता कोई डैशबोर्ड नहीं मिला।";
export const NO_WIDGETS_YET_SEARCH_TITLE = "कोई विजेट नहीं मिला";
export const NO_WIDGETS_YET_SEARCH_DESCRIPTION = "आपकी खोज से मेल खाता कोई विजेट नहीं मिला।";
export const ADD_DASHBOARD_OR_FOLDER = "नया डैशबोर्ड या फ़ोल्डर बनाएं";
export const EDIT_DASHBOARD_OR_FOLDER = "डैशबोर्ड या फ़ोल्डर संपादित करें";
export const ERROR_OCCURED = "डैशबोर्ड खराब है";
export const ERROR_OCCURED_DESCRIPTION = "डैशबोर्ड प्राप्त करते समय एक त्रुटि हुई या डैशबोर्ड मौजूद नहीं है। कृपया बाद में पुनः प्रयास करें।";

// Openground
export const OPENGROUND_MIGRATION_FAILED = "Openground माइग्रेशन विफल रहा!";
export const OPENGROUND_CREATE_FAILED = "Openground इवैल्यूएशन बनाने में विफल!";
export const OPENGROUND_FETCH_FAILED = "Openground इवैल्यूएशन प्राप्त करने में विफल!";
export const OPENGROUND_DELETE_FAILED = "Openground इवैल्यूएशन डिलीट करने में विफल!";
export const OPENGROUND_DATA_MIGRATION_FAILED = "Prisma से ClickHouse में Openground डेटा माइग्रेट करने में विफल!";
export const OPENGROUND_RUN_DETAILS = "रन विवरण";
export const OPENGROUND_PROVIDER_RESPONSE = "प्रोवाइडर रिस्पॉन्स";
export const OPENGROUND_PROVIDER_RESPONSES = "प्रोवाइडर रिस्पॉन्सेस";
export const OPENGROUND_SELECT_PROVIDERS = "तुलना के लिए प्रोवाइडर चुनें";
export const OPENGROUND_SELECT_PROVIDER_ERROR = "कृपया कम से कम एक प्रोवाइडर चुनें";
export const OPENGROUND_ENTER_PROMPT_ERROR = "कृपया एक प्रॉम्प्ट दर्ज करें";
export const OPENGROUND_FILL_VARIABLES_ERROR = "कृपया सभी वेरिएबल भरें";
export const OPENGROUND_EVALUATION_SUCCESS = "इवैल्यूएशन सफलतापूर्वक पूरा हुआ!";
export const OPENGROUND_EVALUATION_FAILED = "इवैल्यूएशन विफल रहा";
export const OPENGROUND_RESET_SUCCESS = "रीसेट पूर्ण। नए इवैल्यूएशन के लिए तैयार।";
export const OPENGROUND_EVALUATION_LOADED = "इवैल्यूएशन लोड हुआ। प्रोवाइडर कॉन्फ़िगर करें और फिर से चलाएं।";
export const OPENGROUND_SELECT_PROVIDERS_BEGIN = "शुरू करने के लिए ऊपर प्रोवाइडर चुनें";
export const OPENGROUND_EVALUATION_COMPLETE = "इवैल्यूएशन पूर्ण";
export const OPENGROUND_READY_TO_EVALUATE = "इवैल्यूएट करने के लिए तैयार";
export const OPENGROUND_PROVIDER_ADDED = "जोड़ा गया। नीचे मॉडल/सेटिंग्स कॉन्फ़िगर करें।";
export const OPENGROUND_LOAD_CONFIG_FAILED = "प्रोवाइडर कॉन्फ़िगरेशन लोड करने में विफल";
export const OPENGROUND_LOAD_PROMPTS_FAILED = "प्रॉम्प्ट हब से प्रॉम्प्ट लोड करने में विफल";
export const OPENGROUND_LOAD_PROMPT_DETAILS_FAILED = "प्रॉम्प्ट विवरण लोड करने में विफल";
export const OPENGROUND_LOAD_VAULT_KEYS_FAILED = "Vault से API की लोड करने में विफल";
export const OPENGROUND_SELECT_API_KEY_ERROR = "कृपया Vault से एक API की चुनें";
export const OPENGROUND_SAVE_CONFIG_FAILED = "कॉन्फ़िगरेशन सेव करने में विफल";
export const OPENGROUND_CONFIG_SAVED = "कॉन्फ़िगरेशन सफलतापूर्वक सेव हुआ!";
export const OPENGROUND_CONFIG_UPDATED = "कॉन्फ़िगरेशन सफलतापूर्वक अपडेट हुआ!";
export const OPENGROUND_SELECT_API_KEY = "एक API की चुनें";
export const OPENGROUND_SELECT_DEFAULT_MODEL = "एक डिफ़ॉल्ट मॉडल चुनें";
export const OPENGROUND_SELECT_PROMPT = "प्रॉम्प्ट हब से एक प्रॉम्प्ट चुनें";
export const OPENGROUND_SAVE_CONFIGURATION = "कॉन्फ़िगरेशन सेव करें";
export const OPENGROUND_UPDATE_CONFIGURATION = "कॉन्फ़िगरेशन अपडेट करें";
export const OPENGROUND_EVALUATING = "इवैल्यूएट हो रहा है...";
export const OPENGROUND_EVALUATING_PROVIDERS = "प्रोवाइडर इवैल्यूएट हो रहे हैं...";
export const OPENGROUND_EVALUATE_PROVIDERS = "प्रोवाइडर इवैल्यूएट करें";
export const OPENGROUND_MAY_TAKE_FEW_SECONDS = "इसमें कुछ सेकंड लग सकते हैं";
export const OPENGROUND_CREATE_NEW_PLAYGROUND = "नया प्लेग्राउंड बनाएं";
export const OPENGROUND_FASTEST_RESPONSE = "सबसे तेज़ रिस्पॉन्स";
export const OPENGROUND_LOWEST_COST = "सबसे कम लागत";
export const OPENGROUND_MOST_EFFICIENT = "सबसे कुशल";
export const OPENGROUND_SUCCESS_RATE = "सफलता दर";
export const OPENGROUND_PROMPT_CONFIGURATION = "प्रॉम्प्ट कॉन्फ़िगरेशन";
export const OPENGROUND_CUSTOM = "कस्टम";
export const OPENGROUND_PROMPT_HUB = "प्रॉम्प्ट हब";
export const OPENGROUND_ENTER_PROMPT_PLACEHOLDER = "अपना प्रॉम्प्ट दर्ज करें... डायनामिक वैल्यूज के लिए {{variable}} का उपयोग करें";
export const OPENGROUND_NO_PROMPTS_FOUND = "प्रॉम्प्ट हब में कोई प्रॉम्प्ट नहीं मिला";
export const OPENGROUND_LOADING_PROMPT_DETAILS = "प्रॉम्प्ट विवरण लोड हो रहे हैं...";
export const OPENGROUND_RAW_RESPONSE_DATA = "रॉ रिस्पॉन्स डेटा";
export const OPENGROUND_RESPONSE_TIME_COMPARISON = "रिस्पॉन्स समय तुलना";
export const OPENGROUND_RESPONSE_TIME_COMPARISON_DESCRIPTION = "प्रोवाइडर रिस्पॉन्स समय की दृश्य तुलना";
export const OPENGROUND_COST_BREAKDOWN = "लागत विवरण";
export const OPENGROUND_COST_BREAKDOWN_DESCRIPTION = "प्रति प्रोवाइडर विस्तृत लागत विश्लेषण";
export const OPENGROUND_CLICK_PROVIDER_CARD_TO_CHANGE_MODEL_OR_SETTINGS = "मॉडल या सेटिंग्स बदलने के लिए प्रोवाइडर कार्ड पर क्लिक करें";
export const OPENGROUND_UPDATE = "अपडेट करें";
export const OPENGROUND_LINK_PROVIDER_TO_VAULT_DESCRIPTION = "इस प्रोवाइडर को अपने Vault से एक API की से लिंक करें और वैकल्पिक रूप से डिफ़ॉल्ट मॉडल सेट करें";
export const OPENGROUND_API_KEY_FROM_VAULT = "API की (Vault से)";
export const OPENGROUND_LOADING_SECRETS = "सीक्रेट्स लोड हो रहे हैं...";
export const OPENGROUND_NO_API_KEYS_FOUND_IN_VAULT = "Vault में कोई API की नहीं मिली।";
export const OPENGROUND_CREATE_NEW_API_KEY = "नई API की बनाएं";
export const OPENGROUND_API_KEY_STORED_IN_VAULT = "API की Vault में संग्रहीत है";
export const OPENGROUND_DEFAULT_MODEL_OPTIONAL = "डिफ़ॉल्ट मॉडल (वैकल्पिक)";
export const OPENGROUND_YOU_CAN_CHANGE_PER_EVALUATION = "आप इसे प्रति इवैल्यूएशन बदल सकते हैं";
export const OPENGROUND_API_KEY_REFERENCE_SAVED_INFO = "API की संदर्भ ClickHouse में सेव है। वास्तविक की Vault में एन्क्रिप्टेड रहती है।";
export const OPENGROUND_PROVIDER_SETTINGS = "प्रोवाइडर सेटिंग्स";
export const OPENGROUND_MODEL = "मॉडल";
export const OPENGROUND_TEMPERATURE = "टेम्परेचर";
export const OPENGROUND_TEMPERATURE_DESCRIPTION = "रैंडमनेस को नियंत्रित करता है: कम अधिक फोकस्ड है, अधिक अधिक क्रिएटिव है";
export const OPENGROUND_MAX_TOKENS = "मैक्स टोकन";
export const OPENGROUND_MAX_TOKENS_DESCRIPTION = "रिस्पॉन्स की अधिकतम लंबाई";
export const OPENGROUND_TOP_P = "टॉप P";
export const OPENGROUND_TOP_P_DESCRIPTION = "न्यूक्लियस सैंपलिंग: शब्द चयन की विविधता को नियंत्रित करता है";
export const OPENGROUND_ENTER_VALUE_FOR = "इसके लिए मान दर्ज करें";
export const OPENGROUND_VARIABLES_SUBSTITUTED_INFO = "ये मान इवैल्यूएशन से पहले आपके प्रॉम्प्ट में प्रतिस्थापित किए जाएंगे";
export const OPENGROUND_CUSTOM_MODEL = "कस्टम मॉडल";
export const OPENGROUND_ENTER_CUSTOM_MODEL_NAME = "कस्टम मॉडल का नाम दर्ज करें";
export const OPENGROUND_USE_CUSTOM_MODEL = "कस्टम मॉडल का उपयोग करें";
export const OPENGROUND_OR_ENTER_CUSTOM = "या कस्टम दर्ज करें";
export const OPENGROUND_MANAGE_MODELS = "मॉडल प्रबंधित करें";
export const OPENGROUND_ADD_NEW_MODEL = "नया मॉडल जोड़ें";
export const OPENGROUND_EDIT_MODEL = "मॉडल संपादित करें";
export const OPENGROUND_MODEL_ID = "मॉडल ID";
export const OPENGROUND_MODEL_DISPLAY_NAME = "प्रदर्शन नाम";
export const OPENGROUND_CONTEXT_WINDOW = "कॉन्टेक्स्ट विंडो";
export const OPENGROUND_INPUT_PRICE_PER_M_TOKENS = "इनपुट मूल्य (प्रति 1M टोकन)";
export const OPENGROUND_OUTPUT_PRICE_PER_M_TOKENS = "आउटपुट मूल्य (प्रति 1M टोकन)";
export const OPENGROUND_MODEL_CAPABILITIES = "क्षमताएं (अल्पविराम से अलग)";
export const OPENGROUND_SAVE_MODEL = "मॉडल सेव करें";
export const OPENGROUND_MODEL_SAVED_SUCCESS = "मॉडल सफलतापूर्वक सेव हुआ!";
export const OPENGROUND_MODEL_DELETED_SUCCESS = "मॉडल सफलतापूर्वक डिलीट हुआ!";
export const OPENGROUND_DELETE_MODEL = "मॉडल डिलीट करें";
export const OPENGROUND_DELETE_MODEL_CONFIRMATION = "क्या आप वाकई इस मॉडल को डिलीट करना चाहते हैं?";
export const OPENGROUND_NO_CUSTOM_MODELS_YET = "अभी तक कोई कस्टम मॉडल नहीं जोड़ा गया। शुरू करने के लिए एक जोड़ें।";
export const OPENGROUND_MANAGE_MODELS_DESCRIPTION = "सभी प्रोवाइडर्स के लिए कस्टम मॉडल देखें और प्रबंधित करें। नए मॉडल जोड़ें या मौजूदा मॉडल को कस्टम प्राइसिंग के साथ क्लोन करें।";
export const OPENGROUND_SELECT_MODEL_TO_VIEW = "विवरण देखने के लिए एक मॉडल चुनें";
export const OPENGROUND_SELECT_MODEL_TO_VIEW_DESCRIPTION = "विवरण देखने के लिए साइडबार से एक मॉडल चुनें, या किसी भी प्रोवाइडर के लिए नया कस्टम मॉडल जोड़ें।";
export const OPENGROUND_STATIC_MODEL = "स्टैटिक मॉडल";
export const OPENGROUND_STATIC_MODEL_DESCRIPTION = "यह एक बिल्ट-इन मॉडल है। अपनी खुद की प्राइसिंग के साथ एक कस्टम संस्करण बनाने के लिए इसे क्लोन करें।";
export const OPENGROUND_CLONE_MODEL = "मॉडल क्लोन करें";
export const OPENGROUND_MODEL_DETAILS = "मॉडल विवरण";
export const OPENGROUND_ADD_CUSTOM_MODEL = "कस्टम मॉडल जोड़ें";
export const OPENGROUND_EDIT_CUSTOM_MODEL = "कस्टम मॉडल संपादित करें";
export const OPENGROUND_ALL_PROVIDERS = "सभी प्रोवाइडर";
export const OPENGROUND_SEARCH_MODELS = "मॉडल खोजें...";
export const OPENGROUND_NO_MODELS_FOUND = "कोई मॉडल नहीं मिला";
export const OPENGROUND_CUSTOM_MODELS = "कस्टम मॉडल";

// Features Title
export const FEATURE_OPENGROUND = "Openground";
export const FEATURE_PROMPTS = "प्रॉम्प्ट हब";
export const FEATURE_VAULT = "Vault";
export const FEATURE_FLEET_HUB = "Fleet Hub";


// Getting Started - Openground
export const GET_STARTED_WITH_OPENGROUND = "Openground के साथ शुरू करें";
export const GET_STARTED_WITH_OPENGROUND_DESCRIPTION = "विभिन्न LLM कॉन्फ़िगरेशन, प्रॉम्प्ट्स और पैरामीटर के साथ प्रयोग और टेस्ट करें। अपने यूज़ केस के लिए इष्टतम सेटअप खोजने के लिए आउटपुट की साइड-बाय-साइड तुलना करें।";
export const GET_STARTED_WITH_OPENGROUND_ACTION_BUTTON = "नया प्लेग्राउंड बनाएं";
export const GET_STARTED_WITH_OPENGROUND_FEATURE_DETAILS = [
	{
		icon: "🔬",
		title: "कॉन्फ़िगरेशन टेस्ट करें",
		description: "अपने विशिष्ट यूज़ केस के लिए सर्वोत्तम कॉन्फ़िगरेशन खोजने के लिए विभिन्न LLM मॉडल, पैरामीटर और सेटिंग्स के साथ प्रयोग करें।",
	},
	{
		icon: "🔄",
		title: "परिणामों की तुलना करें",
		description: "अपने LLM सेटअप के बारे में सूचित निर्णय लेने के लिए विभिन्न कॉन्फ़िगरेशन से आउटपुट को साइड-बाय-साइड देखें।",
	},
	{
		icon: "📝",
		title: "प्रॉम्प्ट टेस्टिंग",
		description: "बेहतर परिणाम और अधिक सटीक AI रिस्पॉन्स प्राप्त करने के लिए अपने प्रॉम्प्ट्स को बार-बार टेस्ट और परिष्कृत करें।",
	},
	{
		icon: "⚡",
		title: "त्वरित पुनरावृत्ति",
		description: "प्रोडक्शन में डिप्लॉय करने से पहले अपने LLM एप्लिकेशन को ऑप्टिमाइज़ करने के लिए तेज़ी से कई वेरिएशन टेस्ट करें।",
	}
];

// Getting Started - PromptHub
export const GET_STARTED_WITH_PROMPT_HUB = "प्रॉम्प्ट हब के साथ शुरू करें";
export const GET_STARTED_WITH_PROMPT_HUB_DESCRIPTION = "प्रॉम्प्ट को वर्जन, डिप्लॉय और कोलैबोरेट करने के लिए केंद्रीकृत प्रॉम्प्ट मैनेजमेंट सिस्टम। प्रॉम्प्ट उपयोग को ट्रैक करें, वेरिएबल प्रबंधित करें, और अपने एप्लिकेशन में आसानी से प्रॉम्प्ट पुनर्प्राप्त करें।";
export const GET_STARTED_WITH_PROMPT_HUB_ACTION_BUTTON = "नया प्रॉम्प्ट बनाएं";
export const GET_STARTED_WITH_PROMPT_HUB_FEATURE_DETAILS = [
	{
		icon: "📝",
		title: "वर्जन कंट्रोल",
		description: "पूर्ण वर्जन इतिहास और रोलबैक क्षमताओं के साथ अपने प्रॉम्प्ट के विभिन्न वर्जन को ट्रैक और प्रबंधित करें।",
	},
	{
		icon: "🔄",
		title: "वेरिएबल सपोर्ट",
		description: "लचीले और पुन: प्रयोज्य प्रॉम्प्ट टेम्प्लेट के लिए वेरिएबल प्लेसहोल्डर के साथ डायनामिक प्रॉम्प्ट बनाएं।",
	},
	{
		icon: "👥",
		title: "टीम कोलैबोरेशन",
		description: "प्रॉम्प्ट विकास पर अपनी टीम के साथ सहयोग करें और ट्रैक करें कि किसने प्रॉम्प्ट बनाए और संशोधित किए।",
	},
	{
		icon: "📊",
		title: "उपयोग ट्रैकिंग",
		description: "यह समझने के लिए कि कौन से प्रॉम्प्ट सबसे मूल्यवान हैं, अपने एप्लिकेशन में प्रॉम्प्ट डाउनलोड और उपयोग को मॉनिटर करें।",
	}
];

// Getting Started - Vault
export const GET_STARTED_WITH_VAULT = "Vault के साथ शुरू करें";
export const GET_STARTED_WITH_VAULT_DESCRIPTION = "अपने सीक्रेट्स को स्टोर, पुनर्प्राप्त और प्रबंधित करने के लिए केंद्रीकृत सीक्रेट मैनेजमेंट सिस्टम। सीक्रेट उपयोग को ट्रैक करें, वेरिएबल प्रबंधित करें, और अपने एप्लिकेशन में आसानी से सीक्रेट पुनर्प्राप्त करें।";
export const GET_STARTED_WITH_VAULT_ACTION_BUTTON = "नया सीक्रेट बनाएं";
export const GET_STARTED_WITH_VAULT_FEATURE_DETAILS = [
	{
		icon: "🔒",
		title: "सुरक्षित स्टोरेज",
		description: "LLM API की और संवेदनशील क्रेडेंशियल को एन्क्रिप्शन और एक्सेस कंट्रोल के साथ सुरक्षित रूप से स्टोर करें।",
	},
	{
		icon: "🔑",
		title: "API एक्सेस",
		description: "अपने एप्लिकेशन के साथ सहज इंटीग्रेशन के लिए प्रमाणित API एंडपॉइंट्स के माध्यम से अपने सीक्रेट्स को एक्सेस करें।",
	},
	{
		icon: "👤",
		title: "यूज़र ट्रैकिंग",
		description: "पूर्ण जवाबदेही और पारदर्शिता के लिए ट्रैक करें कि किसने प्रत्येक सीक्रेट बनाया और अपडेट किया।",
	},
	{
		icon: "⏰",
		title: "अपडेट इतिहास",
		description: "यह सुनिश्चित करने के लिए मॉनिटर करें कि सीक्रेट्स को अंतिम बार कब अपडेट किया गया था, ताकि आपके क्रेडेंशियल करंट और सुरक्षित रहें।",
	}
];

// Getting Started - Tracing
export const GET_STARTED_WITH_TRACING = "ऑब्जर्वेबिलिटी के साथ शुरू करें";
export const GET_STARTED_WITH_TRACING_DESCRIPTION = "ज़ीरो-कोड के साथ LLM, एजेंट, वेक्टर डेटाबेस और GPU को ट्रेस करने के लिए OpenTelemetry-नेटिव ऑटो-इंस्ट्रूमेंटेशन। एप्लिकेशन फ्लो को विज़ुअलाइज़ करें, परफॉर्मेंस बाधाओं की पहचान करें, और विस्तृत स्टैक ट्रेस के साथ त्रुटियों को ट्रैक करें।";
export const GET_STARTED_WITH_TRACING_FEATURE_DETAILS = [
	{
		icon: "🔍",
		title: "ज़ीरो-कोड इंस्ट्रूमेंटेशन",
		description: "अपने मौजूदा कोड को संशोधित किए बिना स्वचालित रूप से LLM, एजेंट, फ्रेमवर्क, वेक्टर डेटाबेस और GPU को ट्रेस करें।",
	},
	{
		icon: "⚡",
		title: "एक्सेप्शन ट्रैकिंग",
		description: "समस्याओं की तेज़ी से पहचान और समाधान के लिए विस्तृत स्टैक ट्रेस के साथ एप्लिकेशन त्रुटियों को ट्रैक और डीबग करें।",
	},
	{
		icon: "🔄",
		title: "OpenTelemetry संगत",
		description: "पूर्ण OpenTelemetry संगतता आपको अपने स्टैक में किसी भी OpenTelemetry-इंस्ट्रूमेंटेड टूल से ट्रेस देखने की अनुमति देती है।",
	},
	{
		icon: "📊",
		title: "परफॉर्मेंस इनसाइट्स",
		description: "अपने GenAI और LLM एप्लिकेशन को ऑप्टिमाइज़ करने के लिए एप्लिकेशन फ्लो को विज़ुअलाइज़ करें और परफॉर्मेंस बाधाओं की पहचान करें।",
	}
];

// Generic texts
export const LOADING = "लोड हो रहा है";
export const CREATED_AT = "बनाया गया";
export const VARIABLES = "वेरिएबल";
export const PROMPT = "प्रॉम्प्ट";
export const PROMPT_PREVIEW = "प्रॉम्प्ट प्रीव्यू";
export const PROMPT_HUB = "प्रॉम्प्ट हब";
export const PROVIDERS = "प्रोवाइडर";
export const NO_DATA_FOUND = "कोई डेटा नहीं मिला!";
export const CANNOT_CONNECT_TO_SERVER = "सर्वर से कनेक्ट नहीं हो सकता!";
export const PLEASE_SELECT = "कृपया चुनें";
export const SELECT = "चुनें";
export const SAVING = "सेव हो रहा है...";
export const UPDATING = "अपडेट हो रहा है...";
export const CONFIGURATION_STORED_SECURELY = "कॉन्फ़िगरेशन सुरक्षित रूप से संग्रहीत";
export const BEST_EFFICIENCY = "सर्वश्रेष्ठ दक्षता";
export const SOME_ERROR_OCCURRED = "ऑपरेशन करते समय कुछ त्रुटि हुई";
export const RESET = "रीसेट करें";
export const ERROR = "त्रुटि";
export const SUCCESS = "सफलता";
export const HIDE = "छुपाएं";
export const SHOW = "दिखाएं";
export const FASTEST = "सबसे तेज़";
export const AVERAGE = "औसत";
export const SLOWEST = "सबसे धीमा";
export const CHEAPEST = "सबसे सस्ता";
export const COMPLETION = "पूर्णता";
export const TOTAL = "कुल";
export const COST = "लागत";
export const TOKENS = "टोकन";
export const CONFIGURE = "कॉन्फ़िगर करें";
export const CONFIGURED = "कॉन्फ़िगर किया गया";
export const SELECTED = "चयनित";
export const CANCEL = "रद्द करें";
export const DELETE = "डिलीट करें";
export const CLOSE = "बंद करें";
export const ACTIONS = "क्रियाएं";
export const JOIN = "शामिल हों";
export const CREATE = "बनाएं";
export const CREATING = "बनाया जा रहा है...";
export const SETTING_UP = "सेटअप हो रहा है...";
export const SELECTING = "चुना जा रहा है...";
export const EDIT_DETAILS = "विवरण संपादित करें";
export const LOG_OUT = "लॉग आउट";
export const EXPAND = "विस्तृत करें";
export const DATABASES = "डेटाबेस";
export const ADD_NEW_CONFIG = "नई कॉन्फ़िग जोड़ें";
export const MANAGE_DB_CONFIG = "DB कॉन्फ़िग प्रबंधित करें";
export const PENDING_INVITATION = "लंबित निमंत्रण";

// Organisation
export const ORGANISATION = "संगठन";
export const ORGANISATIONS = "संगठन";
export const ORGANISATION_NAME = "संगठन का नाम";
export const ORGANISATION_NAME_PLACEHOLDER = "मेरी कंपनी";
export const CREATE_ORGANISATION = "संगठन बनाएं";
export const NEW_ORGANISATION = "नया संगठन";
export const MANAGE_ORGANISATIONS = "संगठन प्रबंधित करें";
export const SWITCH_ORGANISATION = "संगठन बदलें";
export const ORGANISATION_SETTINGS = "संगठन सेटिंग्स";
export const ORGANISATION_SETTINGS_DESCRIPTION = "अपने संगठन और टीम के सदस्यों को प्रबंधित करें";
export const CURRENT_ORGANISATION = "वर्तमान संगठन";
export const UPDATE_ORGANISATION_DETAILS = "अपने संगठन का विवरण अपडेट करें";
export const YOUR_ORGANISATIONS = "आपके संगठन";
export const YOUR_ORGANISATIONS_DESCRIPTION = "वे सभी संगठन जिनके आप सदस्य हैं";
export const YOUR_ORGANISATIONS_ONBOARDING_DESCRIPTION = "आप पहले से ही इन संगठनों के सदस्य हैं। शुरू करने के लिए एक चुनें।";
export const ORGANISATION_CREATED = "संगठन सफलतापूर्वक बनाया गया";
export const ORGANISATION_UPDATED = "संगठन सफलतापूर्वक अपडेट हुआ";
export const ORGANISATION_DELETED = "संगठन सफलतापूर्वक डिलीट हुआ";
export const ORGANISATION_SWITCHED = "संगठन सफलतापूर्वक बदला गया";
export const ORGANISATION_SWITCH_FAILED = "संगठन बदलने में विफल";
export const ORGANISATION_CREATE_FAILED = "संगठन बनाने में विफल";
export const ORGANISATION_UPDATE_FAILED = "संगठन अपडेट करने में विफल";
export const ORGANISATION_DELETE_FAILED = "संगठन डिलीट करने में विफल";
export const ORGANISATION_CREATE_DESCRIPTION = "अपने डेटाबेस और टीम के सदस्यों को प्रबंधित करने के लिए एक नया संगठन बनाएं।";
export const ORGANISATION_DELETE_DESCRIPTION = "इस संगठन को डिलीट करने से पहले सभी सदस्यों को हटा दें।";

// Organisation Members
export const MEMBERS = "सदस्य";
export const MEMBER = "सदस्य";
export const OWNER = "मालिक";
export const ADMIN = "एडमिन";
export const ROLE = "भूमिका";
export const CHANGE_ROLE = "भूमिका बदलें";
export const MEMBER_ROLE_UPDATED = "सदस्य भूमिका सफलतापूर्वक अपडेट हुई";
export const MEMBER_ROLE_UPDATE_FAILED = "सदस्य भूमिका अपडेट करने में विफल";
export const INVITE_MEMBERS = "सदस्यों को आमंत्रित करें";
export const INVITE_MEMBERS_DESCRIPTION = "अपने संगठन में नए सदस्यों को आमंत्रित करें";
export const INVITE_NEW_MEMBER = "नए सदस्य को आमंत्रित करें";
export const INVITE = "आमंत्रित करें";
export const INVITING = "आमंत्रित किया जा रहा है...";
export const INVITATIONS_SENT = "निमंत्रण सफलतापूर्वक भेजे गए";
export const INVITATION_FAILED = "निमंत्रण भेजने में विफल";
export const REMOVE_MEMBER = "सदस्य हटाएं";
export const REMOVE_MEMBER_CONFIRMATION = "क्या आप वाकई इस सदस्य को संगठन से हटाना चाहते हैं?";
export const MEMBER_REMOVED = "सदस्य सफलतापूर्वक हटाया गया";
export const LEAVE_ORGANISATION = "संगठन छोड़ें";
export const LEAVE_ORGANISATION_CONFIRMATION = "क्या आप वाकई इस संगठन को छोड़ना चाहते हैं?";
export const DELETE_ORGANISATION = "संगठन डिलीट करें";
export const DELETE_ORGANISATION_CONFIRMATION = "क्या आप वाकई इस संगठन को डिलीट करना चाहते हैं? यह क्रिया पूर्ववत नहीं की जा सकती।";
export const DANGER_ZONE = "खतरे का क्षेत्र";
export const DANGER_ZONE_DESCRIPTION = "इस संगठन के लिए अपरिवर्तनीय क्रियाएं";
export const GENERAL = "सामान्य";
export const DETAILS = "विवरण";
export const PENDING = "लंबित";
export const NAME = "नाम";
export const EMAIL = "ईमेल";
export const SAVE = "सेव करें";
export const ACTIVE = "सक्रिय";
export const STATUS = "स्थिति";

// Organisation Invitations
export const PENDING_INVITATIONS = "लंबित निमंत्रण";
export const PENDING_INVITES = "लंबित निमंत्रण";
export const PENDING_INVITES_DESCRIPTION = "निमंत्रण भेजे गए लेकिन अभी तक स्वीकार नहीं किए गए";
export const PENDING_INVITATIONS_DESCRIPTION = "आपको निम्नलिखित संगठनों में शामिल होने के लिए आमंत्रित किया गया है";
export const PENDING_INVITATIONS_ONBOARDING_DESCRIPTION = "आपको निम्नलिखित संगठनों में शामिल होने के लिए आमंत्रित किया गया है";
export const INVITATION_ACCEPTED = "संगठन में सफलतापूर्वक शामिल हुए";
export const INVITATION_DECLINED = "निमंत्रण अस्वीकार किया गया";
export const INVITATION_CANCELLED = "निमंत्रण रद्द किया गया";
export const INVITATION_ACCEPT_FAILED = "निमंत्रण स्वीकार करने में विफल";
export const INVITATION_DECLINE_FAILED = "निमंत्रण अस्वीकार करने में विफल";
export const INVITATION_CANCEL_FAILED = "निमंत्रण रद्द करने में विफल";
export const INVITED = "आमंत्रित";

// Onboarding
export const ONBOARDING_WELCOME = "OpenLIT में आपका स्वागत है";
export const ONBOARDING_SUBTITLE = "आइए आपको एक संगठन के साथ सेटअप करें";
export const ONBOARDING_CREATE_DESCRIPTION = "शुरू करने के लिए एक नया संगठन बनाएं";
export const ONBOARDING_SKIP = "अभी के लिए छोड़ें (एक व्यक्तिगत संगठन बनाएं)";
export const PERSONAL_ORGANISATION = "व्यक्तिगत";
