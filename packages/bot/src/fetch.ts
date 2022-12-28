import { logger } from "@para-space/utils";
import { BigNumber, ethers } from "ethers";
import { Types, ParaspaceMM, Factories } from "paraspace-api";
import { runtime } from "./runtime";
import { strategy } from "./strategy";
import { StakedToken, ValidCompoundInfo, ValidTokens } from "./types";

const getValidStakedTokens = async (): Promise<ValidTokens> => {
  logger.debug("Try get valid staked tokens...")
  const apeCoinStaking: Types.ApeCoinStaking = await runtime.provider.connectContract(
    ParaspaceMM.ApeCoinStaking
  );
  const validStakedBayc: StakedToken[] = (
    await apeCoinStaking.getBaycStakes(runtime.contracts.nBAYC)
  )
    .filter((data) =>
      data.unclaimed.gt(ethers.utils.parseEther(strategy[runtime.networkName].BAYC_TOKEN_PENDING_REWARD_LIMIT))
    )
    .map((data) => ({
      pendingReward: data.unclaimed,
      tokenId: data.tokenId.toString(),
    }));
  const validStakedMayc: StakedToken[] = (
    await apeCoinStaking.getMaycStakes(runtime.contracts.nMAYC)
  )
    .filter((data) =>
      data.unclaimed.gt(ethers.utils.parseEther(strategy[runtime.networkName].MAYC_TOKEN_PENDING_REWARD_LIMIT))
    )
    .map((data) => ({
      pendingReward: data.unclaimed,
      tokenId: data.tokenId.toString(),
    }));
  return {
    validBayc: validStakedBayc,
    validMayc: validStakedMayc,
  };
};

const filterByUserLimit = async (validTokens: ValidTokens): Promise<ValidCompoundInfo> => {
  const { ERC721 } = runtime.provider.getContracts();
  let baycOwnerToTokenIds: Map<string, StakedToken[]> = new Map();
  let maycOwnerToTokenIds: Map<string, StakedToken[]> = new Map();

  const nBAYC = runtime.provider.connectFactory(
    Factories.IERC721__factory,
    runtime.contracts.nBAYC
  );
  await Promise.all(
    validTokens.validBayc.map(async (data) => {
      const owner = await nBAYC.ownerOf(data.tokenId);
      if (baycOwnerToTokenIds.has(owner)) {
        baycOwnerToTokenIds.get(owner)?.push(data);
      } else {
        baycOwnerToTokenIds.set(owner, [data]);
      }
    })
  );

  const nMAYC = runtime.provider.connectFactory(
    Factories.IERC721__factory,
    runtime.contracts.nMAYC
  );
  await Promise.all(
    validTokens.validMayc.map(async (data) => {
      const owner = await nMAYC.ownerOf(data.tokenId);
      if (maycOwnerToTokenIds.has(owner)) {
        maycOwnerToTokenIds.get(owner)?.push(data);
      } else {
        maycOwnerToTokenIds.set(owner, [data]);
      }
    })
  );

  baycOwnerToTokenIds.forEach((ids: StakedToken[], owner: string) => {
    const userTotalReward = ids
      .map((data) => data.pendingReward)
      .reduce(
        (accumulator: BigNumber, currentValue: BigNumber) => accumulator.add(currentValue),
        BigNumber.from(0)
      );
    if (
      userTotalReward.lte(
        ethers.utils.parseEther(strategy[runtime.networkName].BAYC_USER_PENDING_REWARD_LIMIT)
      )
    ) {
      baycOwnerToTokenIds.delete(owner);
    }
  });

  maycOwnerToTokenIds.forEach((tokens: StakedToken[], owner: string) => {
    const userTotalReward = tokens
      .map((data) => data.pendingReward)
      .reduce(
        (accumulator: BigNumber, currentValue: BigNumber) => accumulator.add(currentValue),
        BigNumber.from(0)
      );
    if (
      userTotalReward.lte(
        ethers.utils.parseEther(strategy[runtime.networkName].MAYC_USER_PENDING_REWARD_LIMIT)
      )
    ) {
      maycOwnerToTokenIds.delete(owner);
    }
  });
  return {
    bayc: {
      nftAsset: ERC721.BAYC,
      users: Array.from(baycOwnerToTokenIds.keys()),
      tokenIds: Array.from(baycOwnerToTokenIds.keys()).map(
        (owner) => baycOwnerToTokenIds.get(owner)?.map((data) => data.tokenId) || []
      ),
      rawData: baycOwnerToTokenIds,
    },
    mayc: {
      nftAsset: ERC721.MAYC,
      users: Array.from(maycOwnerToTokenIds.keys()),
      tokenIds: Array.from(maycOwnerToTokenIds.keys()).map(
        (owner) => maycOwnerToTokenIds.get(owner)?.map((data) => data.tokenId) || []
      ),
      rawData: maycOwnerToTokenIds,
    },
  };
};

export const fetchCompoundInfo = async (): Promise<ValidCompoundInfo> => {
  const validStakedTokens = await getValidStakedTokens();
  return await filterByUserLimit(validStakedTokens);
};
