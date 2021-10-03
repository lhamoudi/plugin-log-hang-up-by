import { VERSION, TaskHelper } from '@twilio/flex-ui';
import { FlexPlugin } from 'flex-plugin';


const PLUGIN_NAME = 'LogHangUpByPlugin';

// TODO: Use React hooks to more conveniently encapsulate state persistence to local storage!
// TODO: Learn how to do the above using a renderless React component

const DEFAULT_CALL_STATE = {
  currentReservationSid: undefined,
  hangUpBy: 'Customer',
  wasPageRefreshedOnActiveCall: false
};

const LOCAL_STORAGE_KEY = "LogHangUpByPlugin_ActiveCallReservationState";

export default class LogHangUpByPlugin extends FlexPlugin {


  constructor() {
    super(PLUGIN_NAME);
    this.currentReservation = undefined;
    // The object we'll persist to localStorage to ensure state survives page refresh.
    // This allows us to reliably hold onto task attributes until 'beforeCompleteTask'
    // when we apply them. 
    // (see README on why we choose to do that!)
    // NOTE: This simple state object assumes only one call state is ever being tracked 
    // at once. i.e. agent wraps up before another comes in.
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

    // Detect refreshes
    window.onbeforeunload = (event) => {
      if (this.callState.currentReservationSid) {
        const currentReservation = manager.workerClient.reservations.get(this.callState.currentReservationSid);
  
        if (currentReservation && currentReservation.status === 'accepted') {
          console.debug('LogHangUpByPlugin: Page refreshed during live call! ${currentReservation.sid}/${currentReservation.task.sid}');
          // Page was refreshed on an active call. Nothing good can come of this, so we better track it for 
          // use later
          this.callState.wasPageRefreshedOnActiveCall = true;
          this.saveCallState();
        }
      }    
    };
    
    // Initialize the call state which tracks any attributes we might need to apply on
    // 'beforeTaskComplete'. Pull from localStorage first - in case this was a page refresh.
    this.initializeCallState(manager);

    // Grab the reservation SID when the call is answered
    // Retain state for this current voice reservation - so we can record who hung up, for 
    // Flex Insights - upon completion of our task reservation
   flex.Actions.addListener("afterAcceptTask", (payload) => {      
     if (payload.task.taskChannelUniqueName == 'voice') {
        // TODO: Special handling for consult calls reservations! These are not 'Customers' yet
        this.resetCallState(); // Just to be sure we're starting afresh!
        this.callState.currentReservationSid = payload.task.sid;
        // Save to local storage (React hooks will help alleviate need for this boilerplate code)
        this.saveCallState(); 
      }
    });

    // Agent clicked hang up button (hang_up_by='Agent')
    flex.Actions.addListener("beforeHangupCall", (payload) => {
      // ---> CALL YOUR ENDPOINT TO SAVE THIS IMPORTANT BUSINESS STATE <---
      // (If you care)
      // That way - the state will be accurate at the point where your status callback
      // or event stream webhook detects that the call ended. 
    });
    flex.Actions.addListener("afterHangupCall", (payload) => {
      this.callState.hangUpBy = 'Agent';
      this.saveCallState(); 
      // ---> ALTERNATIVELY CALL YOUR ENDPOINT HERE - TO SAVE THIS IMPORTANT BUSINESS STATE <---
      // You just need to be aware that there could be latency between any call disconnected events
      // and this update being made
    });

    // Agent transferred (hang_up_by=undefined)
    flex.Actions.addListener("afterTransferTask", (payload) => {
      // Neither 'Customer' or 'Agent' makes sense for hang_up_by, so set to undefined. 
      // Reporting on transferred tasks/calls is another topic completely
      this.callState.hangUpBy = undefined;
      this.saveCallState(); 
      
      // Agent cancelled transfer (hang_up_by='Customer')
      flex.Actions.addListener("afterCancelTransfer", (payload) => {
        // Agent cancelled the warm transfer during consult call, so revert to defaults again
        this.callState.hangUpBy = DEFAULT_CALL_STATE.hangUpBy;
        this.saveCallState(); 
      });
    });

    // Catch-all logic to perform if call ends unexpectedly
    manager.voiceClient.on("disconnect", () => {
      if (this.callState.currentReservationSid && this.callState.hangUpBy != 'Agent') {
        // Call disconnected during a transfer most likely
        const currentReservation = manager.workerClient.reservations.get(this.callState.currentReservationSid);
        console.debug(`LogHangUpByPlugin: Disconnect fired during ${currentReservation.sid}/${currentReservation.task.sid}`);
        this.callState.hangUpBy = 'Customer';
        this.saveCallState();
      } 
      
    });


    // IMPORTANT: Don't save anything to task attributes until reservation is COMPLETED!
    // Because this is when Flex Insights persists the snapshot of the 'conversations' 
    // attributes to the segment for this reservation.
    // This protects us from race conditions where ANOTHER reservation for the same task
    // (i.e. a transfered call) makes updates to the attributes prior to this reservation
    // being completed and persisted to Insights
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
  initializeCallState(manager) {
    // Check if local storage has anything already. If it does, use it!
    let tmpCallStateAsString = localStorage.getItem(LOCAL_STORAGE_KEY);
    this.callState = tmpCallStateAsString ? JSON.parse(tmpCallStateAsString) : DEFAULT_CALL_STATE;


    if (this.callState.currentReservationSid) {
      const currentReservation = manager.workerClient.reservations.get(this.callState.currentReservationSid);

      if (currentReservation) {
        // We found some call state from local storage, so maybe this was a page refresh or agent 
        // navigated away. Any matching reservation that we retrieve at this point cannot possibly have an active
        // WebRTC connection anymore - so we need to figure out whether agent caused it to disconnect!

        console.debug(`LogHangUpByPlugin: Local storage has call state for in-progress reservation/task ${currentReservation.sid}/${currentReservation.task.sid}...\r\n`, this.callState);
        console.debug(`LogHangUpByPlugin: Reservation status: ${currentReservation.status}`);
    
        // Reservation SID from localStorage is same as a current reservation for this worker. 
        // We know it can't still be a connected call, so check if a refresh was the cause 
            
        if (this.callState.wasPageRefreshedOnActiveCall) {
          // PAGE REFRESH CAUSED THE DISCONNECT
          // Or it happened when agent browser was unreachable - leading to later refresh
          this.callState.hangUpBy = 'Agent-System-Issue'; 
          this.callState.wasPageRefreshedOnActiveCall = false; // Clear flag
        }
      } else {
        // The local storage state is for a since-completed reservation, so it's of no use anymore
        this.resetCallState();

        // (Thinking out loud)
        // It's hard to think of any scenario where there'd be a reservation against an agent - that's not
        // present in the local storage state model. Pending reservations don't matter, because once accepted, they'll
        // be added to the local storage state. And any Accepted reservations could only have been accepted via Flex, so 
        // they would have hit our listener and been persisted to local storage state.
      } 
    }
    // Save to local storage (again, React hooks would alleviate the need for this)
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
    // Must be better way to reset to defaults (immutability of this.callState...)
    this.callState.currentReservationSid = DEFAULT_CALL_STATE.currentReservationSid;
    this.callState.hangUpBy = DEFAULT_CALL_STATE.hangUpBy;
    this.callState.wasPageRefreshedOnActiveCall = DEFAULT_CALL_STATE.wasPageRefreshedOnActiveCall;

    this.saveCallState();
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
      // TODO: Maybe we can include preceded_by and followed_by - for tracking transfers
    }
    task.setAttributes(task.attributes);
  }
}
