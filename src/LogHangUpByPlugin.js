import { VERSION, TaskHelper } from '@twilio/flex-ui';
import { FlexPlugin } from 'flex-plugin';


const PLUGIN_NAME = 'LogHangUpByPlugin';

// The object we'll persist to localStorage to ensure state survives page refresh
// This allows us to reliably hold onto task attributes until 'beforeCompleteTask'
const DEFAULT_CALL_STATE = {
  currentActiveCallReservationSid: undefined,
  hangUpBy: 'Customer'
};
const LOCAL_STORAGE_KEY = "LogHangUpByPlugin_ActiveCallReservationState";

export default class LogHangUpByPlugin extends FlexPlugin {


  constructor() {
    super(PLUGIN_NAME);
    this.currentActiveCallReservation = undefined;
    this.callState = DEFAULT_CALL_STATE;
  }

  /**
   * This code is run when your plugin is being started
   * Use this to modify any UI components or attach to the actions framework
   *
   * @param flex { typeof import('@twilio/flex-ui') }
   * @param manager { import('@twilio/flex-ui').Manager }
   */
  init(flex, manager) {
    
    // Get the active call if there is one 
    // (to cater for page refresh where our object isn't initialized via our listener)
    this.currentActiveCallReservation = this.getActiveVoiceCallReservation(manager);

    // Initialize the call state which tracks any attributes we might need to apply on
    // 'beforeTaskComplete'
    this.initializeCallState();

    // Otherwise we'll grab it when the reservation hits our plugin
    // Keep tabs on this current voice task so we can react to disconnects properly
    manager.workerClient.on('reservationCreated', reservation => {
      if (reservation.task.taskChannelUniqueName == 'voice') {
        this.currentActiveCallReservation = reservation;
        this.callState.currentActiveCallReservationSid = reservation.sid;
        // Save to local storage
        this.saveCallState(); 
      }
    });

    // Agent hung up
    flex.Actions.addListener("beforeHangupCall", (payload) => {
      // ---> CALL YOUR ENDPOINT TO SAVE THIS IMPORTANT BUSINESS STATE <---
      // (If you care)
      // That way - the state will be accurate at the point where your status callback
      // or event stream webhook detects that the call ended.
    });
    flex.Actions.addListener("afterHangupCall", (payload) => {
      this.callState.hangUpBy = 'Agent';
      // Save to local storage
      this.saveCallState(); 
      // ---> ALTERNATIVELY CALL YOUR ENDPOINT HERE - TO SAVE THIS IMPORTANT BUSINESS STATE <---
      // You just need to be aware that there could be latency between any call disconnected events
      // and this update being made.
      this.currentActiveCallReservation = null;
    });

    // Agent transferred
    flex.Actions.addListener("afterTransferTask", (payload) => {
      // Call will disconnect and was transferred. Neither 'Customer' or 'Agent' makes sense
      // for hang_up_by, so set to undefined
      this.callState.hangUpBy = undefined;
      // Save to local storage
      this.saveCallState(); 
    });

    // Customer probably hung up
    manager.voiceClient.on("disconnect", () => {
      if(this.currentActiveCallReservation) {
        // If it was the customer who hung up - that's the default
        // If it was the agent - we covered this in afterHangupCall
        this.currentActiveCallReservation = null;
      }
    });

    // IMPORTANT: Don't save anything to task attributes until reservation is COMPLETED!
    // Because this is when Flex Insights persists the snapshot of the 'conversations' 
    // attributes to the segment for this reservation.
    // This protects us from race conditions where ANOTHER reservation for the same task
    // (i.e. a transfered call) makes updates to the attributes prior to this reservation
    // being completed and persisted to Insights)
    // Just a downside to Taskrouter using the SAME TASK for the entire lifecycle of a 
    // call.
    flex.Actions.addListener("beforeCompleteTask", (payload) => {
      this.persistTaskAttributes(payload.task);
      this.resetCallState();
    });

  }

  /**
   * Create or retrieve call state 
   */
  initializeCallState() {
    // Check of local storage has anything already
    let tmpCallStateAsString = localStorage.getItem(LOCAL_STORAGE_KEY);
    this.callState = DEFAULT_CALL_STATE;
    if (tmpCallStateAsString) {
      this.callState = JSON.parse(tmpCallStateAsString);
    }

    if (this.callState.currentActiveCallReservationSid) {
      // We already have some call state from local storage, so maybe this was a page refresh
      // If we still have the same reservation active, then use this state - otherwise reset it
      if (!this.currentActiveCallReservation || this.currentActiveCallReservation.sid != this.callState.currentActiveCallReservationSid) {
        console.log('Initializing call state');
        this.callState = DEFAULT_CALL_STATE;
      }
    }
    // Save to local storage
    this.saveCallState();     
  }

  /**
   * Save the call state to localStorage
   */
  saveCallState() {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(this.callState));
  }

  resetCallState() {
    localStorage.removeItem(LOCAL_STORAGE_KEY);
    // Must be better way to reset to defaults
    this.callState.currentActiveCallReservationSid = DEFAULT_CALL_STATE.currentActiveCallReservationSid;
    this.callState.hangUpBy = DEFAULT_CALL_STATE.hangUpBy;

    this.saveCallState();
  }

  /** 
   * Returns the task that's either pending or accepted (so we can listen for disconnects)
   */
  getActiveVoiceCallReservation(manager) {
    manager.workerClient.reservations.forEach((reservation, sid) => {
      console.debug("EXISTING RESERVATION! " + reservation.sid);
      console.debug(reservation.task);
      if (TaskHelper.isCallTask(reservation.task) &&
          !(TaskHelper.isCompleted(reservation.task)) &&
          !(TaskHelper.isInWrapupMode(reservation.task))) {
        console.debug("LIVE CALL RESERVATION! " + reservation.sid);
        return reservation;
      }
    });
  }

  /**
   * Saves the task attributes to the task - from our state object 
   */
  persistTaskAttributes(task) {
    if (!('conversations' in task.attributes)) {
      task.attributes.conversations = {};
    }
    if (this.callState.hangUpBy) {
      task.attributes.conversations.hang_up_by = this.callState.hangUpBy;
    }
    task.setAttributes(task.attributes);
  }
}
