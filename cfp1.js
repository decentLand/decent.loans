export async function handle (state, action) {
  const balances = state.balances;
  const invocations = state.invocations;
  const input = action.input;
  const caller = action.caller;
  const foreignCalls = state.foreignCalls

  const FCP1_ADDRESS = "FdY68iYqTvA40U34aXQBBYseGmIUmLV-u57bT7LZWm0"
  const FCP2_ADDRESS = "l2uG_a4IoB3D910lpk2K30enL0rapLbH0GNt5O-PAdA"

  
  if (input.function === "deposit") {
    // token contract address
    const token = input.token
    const qty = input.qty

    if (token !== FCP1_ADDRESS || token !== FCP2_ADDRESS) {
      throw new ContractError(`invalid token supplied`)
    }

    if (! Number.isInteger(qty)) {
      throw new ContractError(`only integer token amount is allowed`)
    }

    const invocation = `{"function": "transfer", "target": "${SmartWeave.contract.id}", "qty": ${qty}}`

    foreignCalls.push({
      contract: token,
      input: invocation
    })

    return { state }

  }

  if (input.function === "readDeposit") {
    //invocation TXID
    const confirmedInvocation = input.invocation
    // the foreign contract
    const readFrom = input.readFrom

    if (typeof readFrom !== "string" || readFrom.length !== 43) {
      throw new ContractError(`invalid SWC address`)
    }

    if (readFrom !== FCP1_ADDRESS || readFrom !== FCP2_ADDRESS) {
      throw new ContractError(`this contract ${readFrom} isn't supported`)
    }

    const foreignState = SmartWeave.contracts.readContractState(readFrom)

    if (! foreignState["invocations"].includes(invocation)) {
      throw new ContractError(`invalid invocation TXID`)
    }
    const invocationTxObject = await SmartWeave.arweave.transactions.get(invocation)
    const invocationOwner = SmartWeave.utils.wallets.ownerToAddress(invocationTxObject.owner)

    if (caller !== invocationOwner) {
      throw new ContractError(`only the invocation owner can read the deposit`)
    }


  }


  if (input.function === "invoke") {
    if (!input.invocation) {
      throw new ContractError(`Missing function invocation`);
    }

    if (!input.foreignContract) {
      throw new ContractError(`Missing foreign contract`);
    }

    state.foreignCalls.push({
      contract: input.foreignContract,
      input: input.invocation
    });
    return { state };
  }
// user invoke the forignCall tx created in ABC by calling readOutBox of DEF
  if (input.function === "readOutbox") {
    if (!input.contract) {
      throw new ContractError(`Missing contract to invoke`);
    }
    const foreignState = await SmartWeave.contracts.readContractState(input.contract);
    console.log("FOREIGN STATE:");
    console.log(foreignState);
    
    if (!foreignState.foreignCalls) {
      throw new ContractError(`Contract is missing support for foreign calls`);
    }

    if (foreignState.foreignCalls[parseInt(input.id)].contract !== SmartWeave.contract.id) {
      throw new ContractError(`This contract is not the target contract chosen in the invocation`);
    }
    const invocation = foreignState.foreignCalls[input.id].input;
    const foreignCall = SmartWeave.transaction.id;

    if (invocations.includes(foreignCall)) {
      throw new ContractError(`Contract invocation already exists`);
    }
    const foreignAction = action;
    foreignAction.caller = input.contract;
    foreignAction.input = invocation;

    const resultState = await handle(state, foreignAction);
    invocations.push(foreignCall);
    return resultState;
  }

  throw new ContractError(`No function supplied or function not recognised: "${input.function}"`);
}

