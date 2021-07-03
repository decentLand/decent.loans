export async function handle(state, action) {

  const balances = state.balances;
  const invocations = state.invocations;
  const input = action.input;
  const caller = action.caller;
  const foreignCalls = state.foreignCalls
  const depositLogs = state.depositLogs
  const loans = state.loans

  const contractTokens = ["FdY68iYqTvA40U34aXQBBYseGmIUmLV-u57bT7LZWm0", "l2uG_a4IoB3D910lpk2K30enL0rapLbH0GNt5O-PAdA" ]

  if (input.function === "reflectDeposit") {
  	const transferTx = input.tx;
  	const tokenContract = input.token;
  	const tagsMap = new Map();

    if (depositLogs.includes(transferTx)) {
      throw new ContractError(`Transaction having ID ${transferTx} is already recorded`)
    }

  	if (! contractTokens.includes(tokenContract)) {
  		throw new ContractError(`unsupported token supplied: ${tokenContract}`)
  	}

    // TODO:
    // add the logic to verify the tx in the validation hashmap
    // to be implemented when smartweave-js publish a new release

    // const testTx = await SmartWeave.contracts.readContract(tokenContract, null, true)

    const depositTransactionObject = await SmartWeave.unsafeClient.transactions.get(transferTx);
    const depositTransactionOwner = depositTransactionObject["owner"];
    const depositTransactionOwnerAddress = await SmartWeave.unsafeClient.wallets.ownerToAddress(depositTransactionOwner);
    const depositTransactionTags = depositTransactionObject.get("tags");

    for (let tag of depositTransactionTags) {
      const key = tag.get("name", {decode: true, string: true})
      const value = tag.get("value", {decode: true, string: true})
      tagsMap.set(key, value)
    }

    if (caller !== depositTransactionOwnerAddress) {
      throw new ContractError(`the caller and the TX owner should be the same`)
    }

    // check the keys of the tags
    if (! tagsMap.has("App-Name")) {
      throw new ContractError(`missing required tag: App-Name`)
    }

    if (! tagsMap.has("App-Version")) {
      throw new ContractError(`missing required tag; App-Version`)
    }

    if (! tagsMap.has("Contract")) {
      throw new ContractError(`missing required tag: Contract`)
    }

    if (! tagsMap.has("Input")) {
      throw new ContractError(`missing required tag: Input`)
    }

    // check the values of the tags
    if ( tagsMap.get("App-Name") !== "SmartWeaveAction") {
      throw new ContractError("incorrect value supplied for 'App-Name' tag")
    }

    if (tagsMap.get("App-Version") !== "0.3.0") {
      throw new ContractError(`incorrect value supplied for 'App-Version' tag`)
    }

    if (! contractTokens.includes( tagsMap.get("Contract") )) {
      throw new ContractError(`incorrect value supplied for 'Contract' tag`)
    }

    const inputObject = JSON.parse( tagsMap.get("Input") )
    if (Object.prototype.toString.call(inputObject) !== "[object Object]" ) {
      throw new ContractError(`incorrect value type supplied for 'Input' tag`)
    }



    const inputsMap = new Map( Object.entries(inputObject) )
    // validate Input object entries
    if (! inputsMap.has("function")) {
      throw new ContractError(`missing required input key: 'function'`)
    }

    if (! inputsMap.has("target")) {
      throw new ContractError(`missing required input key: 'target'`)
    }

    if (! inputsMap.has("qty")) {
      throw new ContractError(`missing required input key: 'qty'`)
    }

    if (inputsMap.get("function") !== "transfer") {
      throw new ContractError(`invalid function invoked: ${inputsMap.get("function")}`)
    }

    if (inputsMap.get("target") !== SmartWeave.contract.id) {
      throw new ContractError(`invalid target supplied: ${inputsMap.get("target")}`)
    }


    if (!balances[tokenContract][caller]) {
      balances[tokenContract][caller] = {
        "availableBalance": inputsMap.get("qty") ,
        "lockedBalance": 0,
        "loansLockedBalance": 0,
        "depositLogs": [SmartWeave.transaction.id],
        "withdrawLogs": [],
        "loanLogs": []
      }

      depositLogs.push(transferTx)

      return { state }
    }

    balances[tokenContract][caller]["availableBalance"] += inputsMap.get("qty")
    balances[tokenContract][caller]["depositLogs"].push(SmartWeave.transaction.id)
    depositLogs.push(transferTx)

    return { state }
  }

  if (input.function === "createLoan") {
    /**
     * create a fixed rate loan undependented of
     * the USD token values.
     * 
     * The lender locks from his wrapped balance
     * in the SWC state asking for a collateral.
     * 
     * The collateral is a $BRIDGE PST token (wERC20).
     * collateral amount is determined by the lender
    **/
    const token = input.token
    const qty = input.qty
    const period = input.period
    const collateralTokenQty = input.collateralTokenQty
    let collateralToken;

    if(! contractTokens.includes(token)) {
      throw new ContractError(`unsupported token supplied ${token}`)
    }

    if (typeof period !== "number" || period > 180) {
      throw new ContractError(`exceed the maximum limit`)
    }

    if (! Number.isInteger(period)) {
      throw new ContractError(`Only integer values are allowed`)
    }

    if (! caller in balances[token]) {
      throw new ContractError(`user having wallet ID ${caller} not found`)
    }

    if (balances[token][caller]["availableBalance"] < qty) {
      throw new ContractError(`Balance too low. Please deposit and try again`)
    }

    if (typeof collateralTokenQty !== "number") {
      throw new ContractError(`invalid collateral value type`)
    }


    switch (token) {
      case "FdY68iYqTvA40U34aXQBBYseGmIUmLV-u57bT7LZWm0":
        collateralToken = "l2uG_a4IoB3D910lpk2K30enL0rapLbH0GNt5O-PAdA"
        break
      case "l2uG_a4IoB3D910lpk2K30enL0rapLbH0GNt5O-PAdA":
        collateralToken = "FdY68iYqTvA40U34aXQBBYseGmIUmLV-u57bT7LZWm0"
        break
    }

    const loanID = SmartWeave.transaction.id

    loans[loanID] = {
      "lender": caller,
      "token": token,
      "qty": qty,
      "length": period,
      "status": "open",
      "collateral": {
        "token": collateralToken,
        "qty": collateralTokenQty
      }
    }

    balances[token][caller]["availableBalance"] -= qty
    balances[token][caller]["loansLockedBalance"] += qty
    balances[token][caller]["loanLogs"].push(loanID)

    return { state }

  }

  if (input.function === "cancelLoan") {
    const loanID = input.loanID
    const token = input.token

    if (! contractTokens.includes(token)) {
      throw new ContractError(`token not supported`)
    }

    if (! loans[loanID]) {
      throw new ContractError(`loan having ID ${loanID} not found`)
    }

    if (! caller in balances[token]) {
      throw new ContractError(`Your wallet not found in ${token} balances`)
    }

    if(loans[loanID]["lender"] !== caller) {
      throw new ContractError(`only loan's creator aka lender can cancel his loan`)
    }

    if (loans[loanID]["status"] !== "open") {
      throw new ContractError(`only loans with status 'open' can be canceled`)
    }

    const lockedLoanToken = loans[loanID]["token"]
    const lockedLoanTokenQty = loans[loanID]["qty"]
    //make the loan unavailable for borrowers
    loans[loanID]["status"] = "canceled"
    //remove the loan's locked token qty from the lender loansLockedBalance
    balances[lockedLoanToken][caller]["loansLockedBalance"] -= lockedLoanTokenQty
    // add the locked token qty to the lender's availableBalance
    balances[lockedLoanToken][caller]["availableBalance"] += lockedLoanTokenQty

    return { state }

  }

  if (input.function === "borrow") {
    const loanID = input.loan
    const blockheight = SmartWeave.block.height

    if (!loans[loanID]) {
      throw new ContractError(`loan having ID ${loanID} not found`)
    }

    if (loans[loanID]["status"] !== "open") {
      throw new ContractError(`loan having ID ${loanID} is not available for borrowing`)
    }

    const lender = loans[loanID]["lender"]
    const token = loans[loanID]["token"]
    const tokenQty = loans[loanID]["qty"]
    const period = loans[loanID]["length"]

    const collateralToken = loans[loanID]["collateral"]["token"]
    const collateralTokenQty = loans[loanID]["collateral"]["qty"]

    if (caller === lender) {
      throw new ContractError(`borrower and lender cannot be the same`)
    }

    //check if the caller have deposited collateralToken in the contract
    if (! balances[collateralToken][caller]) {
      throw new ContractError(`You have not deposited before ${collateralToken}`)
    }

    if( balances[collateralToken][caller]["availableBalance"] < collateralTokenQty) {
      throw new ContractError(`unsufficent balance, please deposit and try again`)
    }

    if (! balances[token][caller]) {
      balances[token][caller] = {
        "availableBalance" : 0,
        "lockedBalance": 0,
        "loansLockedBalance": 0,
        "depositLogs": [],
        "withdrawLogs": [],
        "loanLogs": []
      }
    }

    if (! balances[collateralToken][lender]) {
      balances[collateralToken][lender] = {
        "availableBalance": 0,
        "lockedBalance": 0,
        "loansLockedBalance":0,
        "depositLogs": [],
        "withdrawLogs": [],
        "loanLogs": []
      }
    }

    //adjust the lender balances
    balances[token][lender]["loansLockedBalance"] -= tokenQty
    balances[collateralToken][lender]["lockedBalance"] += collateralTokenQty

    //adjust the borrower balances
    balances[token][caller]["availableBalance"] += tokenQty
    balances[collateralToken][caller]["availableBalance"] -= collateralTokenQty

    //adjust the loan status
    loans[loanID]["status"] = "ongoing"

    loans[loanID]["borrowingMetadata"] = {
      "borrower": caller,
      "expiry": blockheight + (720 * period),
      "borrowingTX": SmartWeave.transaction.id
    }

    return { state }
  }

  if (input.function === "payLoan") {
    const loanID = input.loan
    const blockheight = SmartWeave.block.height

    if (!loans[loanID]) {
      throw new ContractError(`loan having ID ${loanID} not found`)
    }

    if (loans[loanID]["status"] !== "ongoing") {
      throw new ContractError(`loan having ID ${loanID} is not available taken yet`)
    }

    const lender = loans[loanID]["lender"]
    const lendingToken = loans[loanID]["token"]
    const lendingTokenQty = loans[loanID]["qty"]
    const borrower = loans[loanID]["borrowingMetadata"]["borrower"]
    const expiry = loans[loanID]["borrowingMetadata"]["expiry"]
    const collateralToken = loans[loanID]["collateral"]["token"]
    const collateralTokenQty = loans[loanID]["collateral"]["qty"]

    if (caller !== borrower) {
      throw new ContractError(`only borrower can pay the debt`)
    }

    if (expiry < blockheight) {
      throw new ContractError(`loan having ID ${loanID} has reached the expiry deadline. 
        The collateral token can be claimed by the lender by now`)
    }

    if (! (caller in balances[lendingToken])) {
      throw new ContractError(`You have to deposit token ID ${lendingToken} in the contract`)
    }

    if ( balances[lendingToken][caller]["availableBalance"] < collateralTokenQty ) {
      throw new ContractError(`unsufficent balance`)
    }

    //adjust the lender balances
    balances[collateralToken][lender]["lockedBalance"] -= collateralTokenQty
    balances[lendingToken][lender]["availableBalance"] += lendingTokenQty
    //adjust the borrower balances
    balances[collateralToken][caller]["availableBalance"] += collateralTokenQty
    balances[lendingToken][caller]["availableBalance"] -= lendingTokenQty

    loans[loanID]["status"] = "paid"

    return { state }

  }

  if (input.function === "withdraw") {
    const token = input.token
    const qty = input.qty

    if (! contractTokens.includes(token)) {
      throw new ContractError(`unsupported token supplied`)
    }

    if (! balances[token][caller]) {
      throw new ContractError(`Your wallet isn't recorded in the balances`)
    }

    if (balances[token][caller]["availableBalance"] < qty) {
      throw new ContractError(`unsufficent balance. Try lower amount`)
    }

    if (! Number.isInteger(qty)) {
      throw new ContractError(`Only integer values are allowed`)
    }

    balances[token][caller]["availableBalance"] -= qty
    balances[token][caller]["withdrawLogs"].push( SmartWeave.transaction.id )

    const invocation = {
      function: "transfer",
      target: caller,
      qty: qty
    }

    foreignCalls.push({
      contract: token,
      input: invocation
    })

    return { state }

  }

  throw new ContractError(`invalid function supplied: '${input.function}'`);
  
}